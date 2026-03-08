import { DebugStore } from '../debug/debug_store.js'
import { StatsEngine } from '../engine/stats_engine.js'
import { setShouldShow, setExcludedPrefixes } from '../middleware/request_tracking_middleware.js'
import { registerAllRoutes } from '../routes/register_routes.js'
import { log, dim, bold, setVerbose } from '../utils/logger.js'
import { deriveEndpointPaths, computeDashboardPath, collectRegisteredPaths } from './boot_initializer.js'
import { resolveToolbarConfig, buildExcludedPrefixes } from './dashboard_setup.js'
import { buildDiagnostics } from './diagnostics.js'
import { clearAllTimers, persistDebugData, unsubscribeEmailBridge, cleanupResources } from './shutdown_helpers.js'
import {
  hookPinoToLogStream, setupLogStreamBroadcast,
  initDashboardStore, setupStatsIntervalHelper,
  checkDashboardDepsHelper, registerEdgePluginHelper, setupNonWebBridgeHelper,
  setupDevToolbarCore, applyToolbarResult,
} from './provider_helpers_extra.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

interface ContainerWithSingleton {
  singleton(binding: string, factory: () => unknown): void
  make(binding: string): Promise<unknown>
}

export default class ServerStatsProvider {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private engine: StatsEngine | null = null
  private debugStore: DebugStore | null = null
  private dashboardStore: import('../dashboard/dashboard_store.js').DashboardStore | null = null
  private dashboardController: DashboardController | null = null
  private dashboardLogStream: import('../log_stream/log_stream_service.js').LogStreamService | null = null
  private dashboardBroadcastTimer: ReturnType<typeof setInterval> | null = null
  private debugBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private persistPath: string | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private statsController: ServerStatsController | null = null
  private debugController: DebugController | null = null
  private apiController: ApiController | null = null
  private dashboardDepsAvailable = true
  private emailBridgeRedis: unknown = null
  private emailBridgeChannel = 'adonisjs-server-stats:emails'
  private logStreamService: import('../log_stream/log_stream_service.js').LogStreamService | null = null
  private pinoHookActive = false
  private edgePluginActive = false
  private prometheusActive = false
  private transmitAvailable = false
  private transmitChannels: string[] = []
  private resolvedConfig: ResolvedServerStatsConfig | null = null
  private resolvedCollectors: MetricCollector[] = []
  constructor(protected app: ApplicationService) {}

  async boot() {
    if (this.app.getEnvironment() !== 'web') return
    try { await this.initializeBoot() } catch (err) {
      log.warn(`boot failed: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`)
      if ((err as Error)?.stack) console.error((err as Error).stack)
    }
  }

  private async initializeBoot() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) { log.warn('no config found — is config/server_stats.ts set up?'); return }
    setVerbose(config.verbose); log.info('booting...')
    if (config.shouldShow) setShouldShow(config.shouldShow)
    const router = await this.resolveContainer('router')
    if (!router || this.app.inProduction) { this.edgePluginActive = await registerEdgePluginHelper(this.app, config); return }
    const { statsEndpoint, debugEndpoint } = deriveEndpointPaths(config.endpoint, config.devToolbar)
    this.dashboardDepsAvailable = await checkDashboardDepsHelper(config, this.app)
    const dashboardPath = computeDashboardPath(config.devToolbar, this.dashboardDepsAvailable)
    registerAllRoutes({ router: router as import('../routes/router_types.js').AdonisRouter, getApiController: () => this.apiController, getStatsController: () => this.statsController, getDebugController: () => this.debugController, getDashboardController: () => this.dashboardController, statsEndpoint, debugEndpoint, dashboardPath, shouldShow: config.shouldShow })
    const paths = collectRegisteredPaths(statsEndpoint, debugEndpoint, dashboardPath)
    if (paths.length > 0) log.list('routes auto-registered (no manual setup needed):', paths)
    this.edgePluginActive = await registerEdgePluginHelper(this.app, config)
  }

  async ready() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config || (this.app.inTest && config.skipInTest !== false)) return
    if (this.app.getEnvironment() !== 'web') { await setupNonWebBridgeHelper(await this.resolveContainer('emitter'), this.emailBridgeChannel); return }
    setImmediate(() => { this.initializeServerStats(config).catch((err) => { log.warn(`failed to initialize: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`); if ((err as Error)?.stack) console.error((err as Error).stack) }) })
  }

  private async initializeServerStats(config: ResolvedServerStatsConfig) {
    this.resolvedConfig = config
    this.resolvedCollectors = await this.resolveCollectors(config)
    this.engine = new StatsEngine(this.resolvedCollectors)
    ;(this.app.container as unknown as ContainerWithSingleton).singleton('server_stats.engine', () => this.engine!)
    await this.engine.start()
    this.pinoHookActive = hookPinoToLogStream(await this.resolveContainer('logger'))
    this.statsController = new ((await import('../controller/server_stats_controller.js')).default)(this.engine)
    if (config.devToolbar?.enabled && !this.app.inProduction) await this.setupDevToolbar(config)
    const iv = await setupStatsIntervalHelper(this.engine, config, this.app.container as unknown as { make(b: string): Promise<unknown> })
    this.intervalId = iv.intervalId; this.transmitAvailable = iv.transmitAvailable; this.prometheusActive = iv.prometheusActive
    if (iv.channelName) this.transmitChannels.push(iv.channelName)
    const transmit = await this.resolveContainer('transmit')
    if (transmit) this.logStreamService = setupLogStreamBroadcast(transmit as { broadcast(c: string, d: unknown): void }, this.app.config.get<string>('server_stats.logChannelName', 'admin/logs'), this.pinoHookActive, this.app.makePath.bind(this.app))
    log.info('ready')
  }

  private async resolveCollectors(config: ResolvedServerStatsConfig) {
    if (config.collectors && config.collectors !== 'auto') return config.collectors as MetricCollector[]
    const { autoDetectCollectors } = await import('../collectors/auto_detect.js')
    const r = await autoDetectCollectors()
    log.info(`${bold(String(r.active))} of ${bold(String(r.total))} collectors active`); return r.collectors
  }

  private async setupDevToolbar(config: ResolvedServerStatsConfig) {
    const tc = resolveToolbarConfig({ enabled: true, ...config.devToolbar })
    try {
      const result = await setupDevToolbarCore(tc, config, this.app, (b) => this.resolveContainer(b), () => this.getDiagnostics())
      if (result) applyToolbarResult(result, tc, this)
    } catch (err) { log.warn(`dev toolbar setup failed: ${(err as Error)?.message ?? err}\n  ${dim('Stats bar will still work, but debug panel may be unavailable.')}`) }
    const prefixes = buildExcludedPrefixes(tc, config.endpoint as string | false)
    if (prefixes.length > 0) setExcludedPrefixes(prefixes)
    if (!this.debugStore) return
    const { DataAccess: DA } = await import('../data/data_access.js')
    const { ApiController: AC } = await import('../controller/api_controller.js')
    this.apiController = new AC(new DA(this.debugStore, () => this.dashboardStore, this.app.makePath('logs', 'adonisjs.log')))
  }

  private async resolveContainer(binding: string): Promise<unknown> {
    try { return await this.app.container.make(binding) } catch { return null }
  }

  getDiagnostics() {
    return buildDiagnostics({ config: this.resolvedConfig, intervalId: this.intervalId, dashboardBroadcastTimer: this.dashboardBroadcastTimer, debugBroadcastTimer: this.debugBroadcastTimer, flushTimer: this.flushTimer, dashboardStoreReady: this.dashboardStore?.isReady() ?? false, transmitAvailable: this.transmitAvailable, transmitChannels: this.transmitChannels, prometheusActive: this.prometheusActive, pinoHookActive: this.pinoHookActive, edgePluginActive: this.edgePluginActive, emailBridgeActive: this.emailBridgeRedis !== null, resolvedCollectors: this.resolvedCollectors })
  }

  async shutdown() {
    const c = clearAllTimers({ intervalId: this.intervalId, flushTimer: this.flushTimer, debugBroadcastTimer: this.debugBroadcastTimer, dashboardBroadcastTimer: this.dashboardBroadcastTimer })
    this.intervalId = c.intervalId; this.flushTimer = c.flushTimer; this.debugBroadcastTimer = c.debugBroadcastTimer; this.dashboardBroadcastTimer = c.dashboardBroadcastTimer
    await persistDebugData(this.debugStore, this.persistPath)
    this.emailBridgeRedis = unsubscribeEmailBridge(this.emailBridgeRedis, this.emailBridgeChannel)
    await cleanupResources({ logStreamService: this.logStreamService, dashboardLogStream: this.dashboardLogStream, dashboardStore: this.dashboardStore, debugStore: this.debugStore, engine: this.engine })
  }
}

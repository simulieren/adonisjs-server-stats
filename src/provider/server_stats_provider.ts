import { StatsEngine } from '../engine/stats_engine.js'
import { setShouldShow, setExcludedPrefixes } from '../middleware/request_tracking_middleware.js'
import { registerAllRoutes } from '../routes/register_routes.js'
import { log, dim, setVerbose } from '../utils/logger.js'
import {
  deriveEndpointPaths,
  computeDashboardPath,
  collectRegisteredPaths,
  warnAboutAuthMiddleware,
} from './boot_helpers.js'
import { resolveToolbarConfig, buildExcludedPrefixes } from './dashboard_setup.js'
import { buildDiagnostics } from './diagnostics.js'
import {
  hookPinoToLogStream,
  setupLogStreamBroadcast,
  setupStatsIntervalHelper,
  checkDashboardDepsHelper,
  registerEdgePluginHelper,
  setupNonWebBridgeHelper,
  setupDevToolbarCore,
  applyToolbarResult,
} from './provider_helpers_extra.js'
import {
  clearAllTimers,
  persistDebugData,
  unsubscribeEmailBridge,
  cleanupResources,
} from './shutdown_helpers.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { LogStreamService } from '../log_stream/log_stream_service.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

export default class ServerStatsProvider {
  private intervalId: ReturnType<typeof setInterval> | null = null
  engine: StatsEngine | null = null
  debugStore: DebugStore | null = null
  dashboardStore: DashboardStore | null = null
  dashboardController: DashboardController | null = null
  dashboardLogStream: LogStreamService | null = null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null = null
  debugBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  persistPath: string | null = null
  flushTimer: ReturnType<typeof setInterval> | null = null
  private statsController: ServerStatsController | null = null
  debugController: DebugController | null = null
  private apiController: ApiController | null = null
  dashboardDepsAvailable = true
  emailBridgeRedis: unknown = null
  private emailBridgeChannel = 'adonisjs-server-stats:emails'
  private logStreamService: LogStreamService | null = null
  pinoHookActive = false
  edgePluginActive = false
  private prometheusActive = false
  transmitAvailable = false
  transmitChannels: string[] = []
  private resolvedConfig: ResolvedServerStatsConfig | null = null
  private resolvedCollectors: MetricCollector[] = []
  private lucidDebugConnections: string[] = []

  /** Resolves when initStats completes (or rejects). Null if not yet scheduled. */
  private initPromise: Promise<void> | null = null

  constructor(protected app: ApplicationService) {}

  /**
   * Returns a promise that resolves when the provider has finished initializing.
   * Route handlers can await this to avoid 503s during startup.
   * Resolves immediately if init already completed or was never scheduled.
   */
  whenReady(): Promise<void> {
    return this.initPromise ?? Promise.resolve()
  }

  async boot() {
    if (this.app.getEnvironment() !== 'web') return
    try {
      await this.initBoot()
    } catch (err) {
      log.warn(
        `boot failed: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`
      )
      if ((err as Error)?.stack) console.error((err as Error).stack)
    }
  }

  private async initBoot() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) {
      log.warn('no config found — is config/server_stats.ts set up?')
      return
    }
    setVerbose(config.verbose)
    log.info('booting...')
    // Register app root for module resolution (critical in monorepos)
    const { setAppRoot } = await import('../utils/app_import.js')
    setAppRoot(this.app.makePath(''))
    if (config.shouldShow) setShouldShow(config.shouldShow)
    await this.registerRoutes(config)
    this.edgePluginActive = await registerEdgePluginHelper(this.app, config)
  }

  private async registerRoutes(config: ResolvedServerStatsConfig) {
    const router = await this.resolve('router')
    if (!router || this.app.inProduction) return
    this.dashboardDepsAvailable = await checkDashboardDepsHelper(config, this.app)
    const { statsEndpoint, debugEndpoint } = deriveEndpointPaths(config.endpoint, config.devToolbar)
    const dashboardPath = computeDashboardPath(config.devToolbar, this.dashboardDepsAvailable)
    registerAllRoutes({
      router: router as import('../routes/router_types.js').AdonisRouter,
      getApiController: () => this.apiController,
      getStatsController: () => this.statsController,
      getDebugController: () => this.debugController,
      getDashboardController: () => this.dashboardController,
      getDebugStore: () => this.debugStore,
      getApp: () => this.app,
      statsEndpoint,
      debugEndpoint,
      dashboardPath,
      shouldShow: config.shouldShow,
      whenReady: () => this.whenReady(),
    })
    const paths = collectRegisteredPaths(statsEndpoint, debugEndpoint, dashboardPath)
    if (paths.length === 0) return
    log.list('routes auto-registered (no manual setup needed):', paths)
    warnAboutAuthMiddleware(config, this.app.makePath.bind(this.app))
  }

  async ready() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config || (this.app.inTest && config.skipInTest !== false)) return
    if (this.app.getEnvironment() !== 'web') {
      const em = await this.resolve('emitter')
      await setupNonWebBridgeHelper(em, this.emailBridgeChannel)
      return
    }
    this.initPromise = this.initStats(config).catch((err) => {
      log.warn(
        `failed to initialize: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`
      )
      if ((err as Error)?.stack) console.error((err as Error).stack)
    })
    await this.initPromise
  }

  private async initStats(config: ResolvedServerStatsConfig) {
    this.resolvedConfig = config
    this.resolvedCollectors = await this.resolveCollectors(config)
    this.engine = new StatsEngine(this.resolvedCollectors)
    const container = this.app.container as unknown as {
      singleton(b: string, f: () => unknown): void
      make(b: string): Promise<unknown>
    }
    container.singleton('server_stats.engine', () => this.engine!)
    await this.engine.start()
    this.pinoHookActive = hookPinoToLogStream(await this.resolve('logger'))
    const SC = (await import('../controller/server_stats_controller.js')).default
    this.statsController = new SC(this.engine)
    if (config.devToolbar?.enabled && !this.app.inProduction) {
      this.checkLucidDebugFlag()
      await this.setupDevToolbar(config)
    }
    const iv = await setupStatsIntervalHelper(this.engine, config, container)
    this.intervalId = iv.intervalId
    if (iv.transmitAvailable) this.transmitAvailable = true
    if (iv.prometheusActive) this.prometheusActive = true
    if (iv.channelName && !this.transmitChannels.includes(iv.channelName)) {
      this.transmitChannels.push(iv.channelName)
    }
    await this.setupLogBroadcast()
    log.info('ready')
  }

  private async resolveCollectors(config: ResolvedServerStatsConfig) {
    if (config.collectors && config.collectors !== 'auto') {
      return config.collectors as MetricCollector[]
    }
    const { autoDetectCollectors } = await import('../collectors/auto_detect.js')
    const r = await autoDetectCollectors()
    log.info(`${r.active} of ${r.total} collectors active`)
    return r.collectors
  }

  private async setupDevToolbar(config: ResolvedServerStatsConfig) {
    const tc = resolveToolbarConfig({ enabled: true, ...config.devToolbar })
    try {
      const result = await setupDevToolbarCore({
        tc,
        config,
        app: this.app,
        resolve: (b) => this.resolve(b),
        getDiagnostics: () => this.getDiagnostics(),
      })
      if (result) applyToolbarResult(result, tc, this as unknown as import('./toolbar_setup.js').ProviderFields)
    } catch (err) {
      log.warn(
        `dev toolbar setup failed: ${(err as Error)?.message ?? err}\n  ${dim('Stats bar will still work.')}`
      )
    }
    const pfx = buildExcludedPrefixes(tc, config.endpoint as string | false)
    if (pfx.length > 0) setExcludedPrefixes(pfx)
    if (!this.debugStore) {
      log.warn('debugStore is null after toolbar setup — apiController will not be created')
      return
    }
    const { DataAccess: DA } = await import('../data/data_access.js')
    const { ApiController: AC } = await import('../controller/api_controller.js')
    this.apiController = new AC(
      new DA(this.debugStore, () => this.dashboardStore, this.app.makePath('logs', 'adonisjs.log'))
    )
    log.info('apiController created')
  }

  private async setupLogBroadcast() {
    const t = (await this.resolve('transmit')) as {
      broadcast(c: string, d: unknown): void
    } | null
    if (!t) return
    const ch = this.app.config.get<string>('server_stats.logChannelName', 'admin/logs')
    this.logStreamService = setupLogStreamBroadcast(
      t,
      ch,
      this.pinoHookActive,
      this.app.makePath.bind(this.app)
    )
  }

  private async resolve(binding: string) {
    try {
      return await this.app.container.make(binding)
    } catch (err) {
      log.info(`resolve('${binding}') failed: ${(err as Error)?.message ?? err}`)
      return null
    }
  }

  /**
   * Check Lucid database connections for `debug: true` and warn if missing.
   * Without it, Lucid won't emit `db:query` events and no queries will be captured.
   */
  private checkLucidDebugFlag() {
    const dbConfig = this.app.config.get<{
      connection?: string
      connections?: Record<string, { debug?: boolean }>
    }>('database')
    if (!dbConfig?.connections) return
    const enabled: string[] = []
    const disabled: string[] = []
    for (const [name, conn] of Object.entries(dbConfig.connections)) {
      if (conn?.debug) enabled.push(name)
      else disabled.push(name)
    }
    this.lucidDebugConnections = enabled
    if (enabled.length === 0 && disabled.length > 0) {
      log.block('query capture is disabled — no Lucid connections have debug: true', [
        '',
        dim('Lucid only emits db:query events when debug is enabled on a connection.'),
        dim('Add this to your database connection in config/database.ts:'),
        '',
        `  ${disabled[0]}: {`,
        `    client: '...',`,
        `    debug: true,      ${dim('// ← enables query capture')}`,
        `    connection: { ... },`,
        `  }`,
        '',
        dim(`Connections without debug: ${disabled.join(', ')}`),
      ])
    }
  }

  getDiagnostics() {
    return buildDiagnostics({
      intervalId: this.intervalId,
      dashboardBroadcastTimer: this.dashboardBroadcastTimer,
      debugBroadcastTimer: this.debugBroadcastTimer,
      flushTimer: this.flushTimer,
      dashboardStoreReady: this.dashboardStore?.isReady() ?? false,
      transmitAvailable: this.transmitAvailable,
      transmitChannels: this.transmitChannels,
      prometheusActive: this.prometheusActive,
      pinoHookActive: this.pinoHookActive,
      edgePluginActive: this.edgePluginActive,
      emailBridgeActive: this.emailBridgeRedis !== null,
      hasCacheCollector: this.resolvedCollectors.some((c) => c.name === 'redis'),
      hasQueueCollector: this.resolvedCollectors.some((c) => c.name === 'queue'),
      config: this.resolvedConfig,
      lucidDebugConnections: this.lucidDebugConnections,
    })
  }

  async shutdown() {
    clearAllTimers({
      intervalId: this.intervalId,
      flushTimer: this.flushTimer,
      dashboardBroadcastTimer: this.dashboardBroadcastTimer,
      debugBroadcastTimer: this.debugBroadcastTimer,
    })
    this.intervalId = null
    this.flushTimer = null
    this.dashboardBroadcastTimer = null
    this.debugBroadcastTimer = null
    await persistDebugData(this.debugStore, this.persistPath)
    unsubscribeEmailBridge(this.emailBridgeRedis, this.emailBridgeChannel)
    this.emailBridgeRedis = null
    await cleanupResources({
      logStreamService: this.logStreamService,
      dashboardLogStream: this.dashboardLogStream,
      dashboardStore: this.dashboardStore,
      debugStore: this.debugStore,
      engine: this.engine,
    })
  }
}

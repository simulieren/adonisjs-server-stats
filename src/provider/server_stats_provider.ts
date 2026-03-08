import { DebugStore } from '../debug/debug_store.js'
import { StatsEngine } from '../engine/stats_engine.js'
import {
  setShouldShow,
  setTraceCollector,
  setExcludedPrefixes,
} from '../middleware/request_tracking_middleware.js'
import { registerAllRoutes } from '../routes/register_routes.js'
import { log, dim, bold, setVerbose } from '../utils/logger.js'
import {
  checkDashboardDependencies,
  deriveEndpointPaths,
  computeDashboardPath,
  collectRegisteredPaths,
} from './boot_initializer.js'
import { resolveToolbarConfig, buildExcludedPrefixes } from './dashboard_setup.js'
import { buildDiagnostics } from './diagnostics.js'
import { setupPublisherOnlyBridge } from './email_bridge.js'
import {
  hookPinoToLogStream,
  setupLogStreamBroadcast,
  warnAboutGlobalAuth,
  resolveRedisForBridge,
  createDebugController,
  setupDebugBroadcastHelper,
  setupEmailBridgeFromProvider,
  initDashboardStore,
  setupStatsIntervalHelper,
} from './provider_helpers_extra.js'
import {
  clearAllTimers,
  persistDebugData,
  unsubscribeEmailBridge,
  cleanupResources,
} from './shutdown_helpers.js'
import { createPeriodicFlushTimer, resolvePersistPath } from './toolbar_setup.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DevToolbarConfig } from '../debug/types.js'
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
  private dashboardLogStream:
    | import('../log_stream/log_stream_service.js').LogStreamService
    | null = null
  private dashboardBroadcastTimer: ReturnType<typeof setInterval> | null = null
  private debugBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private persistPath: string | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private statsController: ServerStatsController | null = null
  private debugController: DebugController | null = null
  private apiController: ApiController | null = null
  private dashboardDepsAvailable: boolean = true
  private emailBridgeRedis: unknown = null
  private emailBridgeChannel: string = 'adonisjs-server-stats:emails'
  private logStreamService: import('../log_stream/log_stream_service.js').LogStreamService | null =
    null
  private pinoHookActive: boolean = false
  private edgePluginActive: boolean = false
  private prometheusActive: boolean = false
  private transmitAvailable: boolean = false
  private transmitChannels: string[] = []
  private resolvedConfig: ResolvedServerStatsConfig | null = null
  private resolvedCollectors: MetricCollector[] = []

  constructor(protected app: ApplicationService) {}

  async boot() {
    if (this.app.getEnvironment() !== 'web') return
    try {
      await this.initializeBoot()
    } catch (err) {
      log.warn(
        `boot failed: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`
      )
      if ((err as Error)?.stack) console.error((err as Error).stack)
    }
  }

  private async initializeBoot() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) {
      log.warn('no config found — is config/server_stats.ts set up?')
      return
    }
    setVerbose(config.verbose)
    log.info('booting...')
    if (config.shouldShow) setShouldShow(config.shouldShow)
    const router = await this.resolveContainer('router')
    if (!router || this.app.inProduction) {
      await this.registerEdgePlugin(config)
      return
    }
    const { statsEndpoint, debugEndpoint } = deriveEndpointPaths(config.endpoint, config.devToolbar)
    await this.checkAndRegisterDashboardDeps(config)
    const dashboardPath = computeDashboardPath(config.devToolbar, this.dashboardDepsAvailable)
    registerAllRoutes({
      router: router as import('../routes/router_types.js').AdonisRouter,
      getApiController: () => this.apiController,
      getStatsController: () => this.statsController,
      getDebugController: () => this.debugController,
      getDashboardController: () => this.dashboardController,
      statsEndpoint,
      debugEndpoint,
      dashboardPath,
      shouldShow: config.shouldShow,
    })
    const paths = collectRegisteredPaths(statsEndpoint, debugEndpoint, dashboardPath)
    if (paths.length > 0) {
      log.list('routes auto-registered (no manual setup needed):', paths)
      warnAboutGlobalAuth(config, this.app.makePath.bind(this.app))
    }
    await this.registerEdgePlugin(config)
  }

  private async checkAndRegisterDashboardDeps(config: ResolvedServerStatsConfig) {
    if (!config.devToolbar?.enabled || !config.devToolbar.dashboard) return
    const { appImport } = await import('../utils/app_import.js')
    const deps = await checkDashboardDependencies(appImport)
    if (deps.available) return
    this.dashboardDepsAvailable = false
    log.block(`Dashboard requires ${deps.missing.join(' and ')}. Install with:`, [
      '',
      bold(`npm install ${deps.missing.join(' ')}`),
      '',
      dim('Dashboard routes have been skipped for now.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
  }

  private async registerEdgePlugin(config: ResolvedServerStatsConfig) {
    if (!this.app.usingEdgeJS) return
    try {
      const { appImport } = await import('../utils/app_import.js')
      const edge = await appImport<typeof import('edge.js')>('edge.js')
      const { edgePluginServerStats } = await import('../edge/plugin.js')
      edge.default.use(edgePluginServerStats(config))
      this.edgePluginActive = true
    } catch (err) {
      log.warn('could not register Edge plugin: ' + (err as Error)?.message)
    }
  }

  async ready() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config || (this.app.inTest && config.skipInTest !== false)) return
    if (this.app.getEnvironment() !== 'web') {
      await this.setupNonWebBridge()
      return
    }
    setImmediate(() => {
      this.initializeServerStats(config).catch((err) => {
        log.warn(
          `failed to initialize: ${(err as Error)?.message ?? err}\n  ${dim('The server will continue without server-stats.')}`
        )
        if ((err as Error)?.stack) console.error((err as Error).stack)
      })
    })
  }

  private async setupNonWebBridge() {
    const emitter = await this.resolveContainer('emitter')
    if (!emitter) return
    const redis = await resolveRedisForBridge()
    if (redis) {
      setupPublisherOnlyBridge(
        emitter as { on(e: string, h: (...a: unknown[]) => void): void },
        redis,
        this.emailBridgeChannel
      )
    }
  }

  private async initializeServerStats(config: ResolvedServerStatsConfig) {
    this.resolvedConfig = config
    this.resolvedCollectors = await this.resolveCollectors(config)
    this.engine = new StatsEngine(this.resolvedCollectors)
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'server_stats.engine',
      () => this.engine!
    )
    await this.engine.start()
    this.pinoHookActive = hookPinoToLogStream(await this.resolveContainer('logger'))
    this.statsController = new (await import('../controller/server_stats_controller.js')).default(
      this.engine
    )
    if (config.devToolbar?.enabled && !this.app.inProduction) {
      await this.setupDevToolbar(config)
    }
    const container = this.app.container as unknown as {
      make(b: string): Promise<unknown>
    }
    const intervals = await setupStatsIntervalHelper(this.engine, config, container)
    this.intervalId = intervals.intervalId
    this.transmitAvailable = intervals.transmitAvailable
    this.prometheusActive = intervals.prometheusActive
    if (intervals.channelName) this.transmitChannels.push(intervals.channelName)
    const transmit = await this.resolveContainer('transmit')
    if (transmit) {
      this.logStreamService = setupLogStreamBroadcast(
        transmit as { broadcast(c: string, d: unknown): void },
        this.app.config.get<string>('server_stats.logChannelName', 'admin/logs'),
        this.pinoHookActive,
        this.app.makePath.bind(this.app)
      )
    }
    log.info('ready')
  }

  private async resolveCollectors(config: ResolvedServerStatsConfig) {
    if (config.collectors && config.collectors !== 'auto') {
      return config.collectors as MetricCollector[]
    }
    const { autoDetectCollectors } = await import('../collectors/auto_detect.js')
    const r = await autoDetectCollectors()
    log.info(`${bold(String(r.active))} of ${bold(String(r.total))} collectors active`)
    return r.collectors
  }

  private async setupDevToolbar(config: ResolvedServerStatsConfig) {
    const toolbarConfig = resolveToolbarConfig({
      enabled: true,
      ...config.devToolbar,
    })
    try {
      await this.setupDevToolbarInner(toolbarConfig, config)
    } catch (err) {
      log.warn(
        `dev toolbar setup failed: ${(err as Error)?.message ?? err}\n  ${dim('Stats bar will still work, but debug panel may be unavailable.')}`
      )
    }
    const prefixes = buildExcludedPrefixes(toolbarConfig, config.endpoint as string | false)
    if (prefixes.length > 0) setExcludedPrefixes(prefixes)
    if (!this.debugStore) return
    const { DataAccess: DA } = await import('../data/data_access.js')
    const { ApiController: AC } = await import('../controller/api_controller.js')
    this.apiController = new AC(
      new DA(this.debugStore, () => this.dashboardStore, this.app.makePath('logs', 'adonisjs.log'))
    )
  }

  private async setupDevToolbarInner(
    toolbarConfig: DevToolbarConfig,
    config: ResolvedServerStatsConfig
  ) {
    this.debugStore = new DebugStore(toolbarConfig)
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'debug.store',
      () => this.debugStore!
    )
    this.persistPath = resolvePersistPath(
      toolbarConfig.persistDebugData,
      this.app.makePath.bind(this.app)
    )
    if (this.persistPath) await this.debugStore.loadFromDisk(this.persistPath)
    const emitter = await this.resolveContainer('emitter')
    if (!emitter) {
      log.warn('AdonisJS emitter not available — query and event collection will be disabled')
    }
    await this.debugStore.start(emitter, await this.resolveContainer('router'))
    this.emailBridgeRedis = await setupEmailBridgeFromProvider(
      emitter,
      this.emailBridgeChannel,
      this.debugStore,
      this.dashboardStore
    )
    this.debugController = await createDebugController(this.debugStore, config, {
      getEngine: () => this.engine,
      getDashboardStore: () => this.dashboardStore,
      getProviderDiagnostics: () => this.getDiagnostics(),
      getApp: () => this.app,
    })
    if (this.debugStore.traces) setTraceCollector(this.debugStore.traces)
    this.flushTimer = createPeriodicFlushTimer(this.persistPath, this.debugStore)
    const bc = await setupDebugBroadcastHelper(
      this.debugStore,
      await this.resolveContainer('transmit')
    )
    if (bc) {
      this.transmitAvailable = true
      this.transmitChannels.push(...bc.channels)
      this.debugStore.onNewItem(() => {
        this.debugBroadcastTimer = bc.getTimer()
      })
    }
    if (toolbarConfig.dashboard && this.dashboardDepsAvailable) {
      setImmediate(() => {
        this.initDashboard(toolbarConfig, emitter)
      })
    }
  }

  private initDashboard(toolbarConfig: DevToolbarConfig, emitter: unknown) {
    initDashboardStore(
      toolbarConfig,
      emitter,
      this.app,
      this.debugStore!,
      this.engine!,
      this.pinoHookActive,
      this.transmitChannels,
      (result) => {
        this.dashboardStore = result.dashboardStore
        this.dashboardController = result.dashboardController
        this.dashboardLogStream = result.dashboardLogStream
        this.dashboardBroadcastTimer = result.dashboardBroadcastTimer
        if (result.dashboardBroadcastTimer) this.transmitAvailable = true
      }
    ).catch((err) => {
      log.warn(
        `dashboard setup failed: ${(err as Error)?.message ?? err}\n  ${dim('Everything else continues to work.')}`
      )
    })
  }

  private async resolveContainer(binding: string): Promise<unknown> {
    try {
      return await this.app.container.make(binding)
    } catch {
      return null
    }
  }

  getDiagnostics() {
    return buildDiagnostics({
      config: this.resolvedConfig,
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
      resolvedCollectors: this.resolvedCollectors,
    })
  }

  async shutdown() {
    const cleared = clearAllTimers({
      intervalId: this.intervalId,
      flushTimer: this.flushTimer,
      debugBroadcastTimer: this.debugBroadcastTimer,
      dashboardBroadcastTimer: this.dashboardBroadcastTimer,
    })
    this.intervalId = cleared.intervalId
    this.flushTimer = cleared.flushTimer
    this.debugBroadcastTimer = cleared.debugBroadcastTimer
    this.dashboardBroadcastTimer = cleared.dashboardBroadcastTimer
    await persistDebugData(this.debugStore, this.persistPath)
    this.emailBridgeRedis = unsubscribeEmailBridge(this.emailBridgeRedis, this.emailBridgeChannel)
    await cleanupResources({
      logStreamService: this.logStreamService,
      dashboardLogStream: this.dashboardLogStream,
      dashboardStore: this.dashboardStore,
      debugStore: this.debugStore,
      engine: this.engine,
    })
  }
}

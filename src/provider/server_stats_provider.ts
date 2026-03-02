import { readFileSync } from 'node:fs'

import { getLogStreamService } from '../collectors/log_collector.js'
import { DashboardStore } from '../dashboard/dashboard_store.js'
import { DataAccess } from '../data/data_access.js'
import { DebugStore } from '../debug/debug_store.js'
import { StatsEngine } from '../engine/stats_engine.js'
import { LogStreamService } from '../log_stream/log_stream_service.js'
import {
  setShouldShow,
  setTraceCollector,
  setDashboardPath,
  setExcludedPrefixes,
  setOnRequestComplete,
} from '../middleware/request_tracking_middleware.js'
import { registerAllRoutes } from '../routes/register_routes.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DevToolbarConfig } from '../debug/types.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

/** Minimal interface for the AdonisJS IoC container with singleton registration. */
interface ContainerWithSingleton {
  singleton(binding: string, factory: () => unknown): void
  make(binding: string): Promise<unknown>
}

export default class ServerStatsProvider {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private engine: StatsEngine | null = null
  private debugStore: DebugStore | null = null
  private dashboardStore: DashboardStore | null = null
  private dashboardController: DashboardController | null = null
  private dashboardLogStream: LogStreamService | null = null
  private dashboardBroadcastTimer: ReturnType<typeof setInterval> | null = null
  private debugBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private persistPath: string | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private statsController: ServerStatsController | null = null
  private debugController: DebugController | null = null
  private apiController: ApiController | null = null

  // Diagnostics tracking
  private pinoHookActive: boolean = false
  private edgePluginActive: boolean = false
  private prometheusActive: boolean = false
  private transmitAvailable: boolean = false
  private transmitChannels: string[] = []
  private resolvedConfig: ResolvedServerStatsConfig | null = null
  private resolvedCollectors: MetricCollector[] = []

  constructor(protected app: ApplicationService) {}

  async boot() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) return

    // Wire up the per-request shouldShow callback
    if (config.shouldShow) {
      setShouldShow(config.shouldShow)
    }

    let router: unknown = null
    try {
      router = await this.app.container.make('router')
    } catch {
      // Router not available — skip all route registration
    }

    if (router && !this.app.inProduction) {
      const registeredPaths: string[] = []
      const r = router as import('../routes/router_types.js').AdonisRouter
      const toolbarConfig = config.devToolbar

      // Derive endpoint paths for route registration
      const statsEndpoint = typeof config.endpoint === 'string' ? config.endpoint : false
      const debugEndpoint = toolbarConfig?.enabled
        ? (toolbarConfig.debugEndpoint ?? '/admin/api/debug')
        : undefined
      const dashboardPath =
        toolbarConfig?.enabled && toolbarConfig.dashboard
          ? (toolbarConfig.dashboardPath ?? '/__stats')
          : undefined

      // ── Register all routes via the unified registrar ──────────
      registerAllRoutes({
        router: r,
        getApiController: () => this.apiController,
        getStatsController: () => this.statsController,
        getDebugController: () => this.debugController,
        getDashboardController: () => this.dashboardController,
        statsEndpoint,
        debugEndpoint,
        dashboardPath,
        shouldShow: config.shouldShow,
      })

      // Track which paths were registered for logging
      if (typeof statsEndpoint === 'string') {
        registeredPaths.push(statsEndpoint)
      }
      if (debugEndpoint) {
        registeredPaths.push(debugEndpoint + '/*')
      }
      if (dashboardPath) {
        registeredPaths.push(dashboardPath + '/*')
      }

      // Log registered routes
      if (registeredPaths.length > 0) {
        log.list('routes registered:', registeredPaths)

        // Only warn about global auth middleware if:
        // 1. shouldShow is NOT configured (user hasn't set up access control)
        // 2. There IS auth middleware in server.use() or router.use()
        if (!config.shouldShow) {
          const authMiddleware = this.detectGlobalAuthMiddleware()
          if (authMiddleware.length > 0) {
            log.block(bold('found global auth middleware that will run on every poll:'), [
              ...authMiddleware.map((m) => `${dim('→')} ${m}`),
              '',
              dim('these routes get polled every ~3s, so auth middleware will'),
              dim('trigger a DB query on each poll. here are two ways to fix it:'),
              '',
              `${bold('option 1:')} add a shouldShow callback to your config:`,
              '',
              dim('// config/server_stats.ts'),
              dim("shouldShow: (ctx) => ctx.auth?.user?.role === 'admin'"),
              '',
              `${bold('option 2:')} move auth middleware from router.use() to a route group:`,
              '',
              dim('// start/kernel.ts — remove from router.use()'),
              dim("// () => import('#middleware/silent_auth_middleware')"),
              '',
              dim('// start/routes.ts — add to your route groups instead'),
              dim('router.group(() => { ... }).use(middleware.silentAuth())'),
            ])
          }
        }
      }
    }

    if (!this.app.usingEdgeJS) return

    try {
      const edge = await import('edge.js')
      const { edgePluginServerStats } = await import('../edge/plugin.js')
      edge.default.use(edgePluginServerStats(config))
      this.edgePluginActive = true
    } catch (err) {
      log.warn(
        'could not register Edge plugin — @serverStats() tag will not work: ' +
          (err as Error)?.message
      )
    }
  }

  /**
   * Read start/kernel.ts and detect auth-related middleware in server.use()
   * or router.use() blocks. Returns import paths of problematic middleware.
   *
   * Ignores initialize_auth_middleware (no DB query — just sets up ctx.auth).
   */
  private detectGlobalAuthMiddleware(): string[] {
    const found: string[] = []

    try {
      // Try both .ts and .js extensions
      let source = ''
      for (const ext of ['ts', 'js']) {
        try {
          source = readFileSync(this.app.makePath('start', `kernel.${ext}`), 'utf-8')
          if (source) break
        } catch {
          // Try next extension
        }
      }

      if (!source) return found

      // Extract server.use([...]) and router.use([...]) blocks
      const useBlockRegex = /(?:server|router)\.use\(\s*\[([\s\S]*?)\]\s*\)/g
      let match: RegExpExecArray | null

      while ((match = useBlockRegex.exec(source)) !== null) {
        const block = match[1]

        // Find all import paths in this block
        const importRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g
        let importMatch: RegExpExecArray | null

        while ((importMatch = importRegex.exec(block)) !== null) {
          const importPath = importMatch[1]

          // Skip initialize_auth_middleware — it just sets up ctx.auth, no DB query
          if (importPath.includes('initialize_auth')) continue

          // Detect auth-related middleware
          if (
            importPath.includes('auth') ||
            importPath.includes('silent_auth') ||
            importPath.includes('silentAuth')
          ) {
            found.push(importPath)
          }
        }
      }
    } catch {
      // Can't read kernel file — skip detection
    }

    return found
  }

  /**
   * Hook into the AdonisJS logger's Pino stream to feed log entries
   * directly into the LogStreamService — no file path needed.
   *
   * Uses `Symbol.for('pino.stream')` (documented Pino API) to access
   * the underlying destination stream, then wraps its `write` method
   * to tee entries into the log collector.
   */
  private async hookPinoLogger() {
    const logStream = getLogStreamService()
    if (!logStream) return // logCollector() not in the config

    let logger: unknown
    try {
      logger = await this.app.container.make('logger')
    } catch {
      // Logger not available
    }

    const pino = (logger as Record<string, unknown> | null)?.pino
    if (!pino) return

    const streamSym = Symbol.for('pino.stream')
    const rawStream = (pino as Record<symbol, unknown>)[streamSym]
    if (!rawStream || typeof (rawStream as Record<string, unknown>).write !== 'function') return

    const stream = rawStream as { write: Function; [key: string]: unknown }
    const originalWrite = stream.write.bind(stream)
    stream.write = function (chunk: string | Uint8Array, ...args: unknown[]) {
      try {
        const str = typeof chunk === 'string' ? chunk : chunk.toString()
        const entry = JSON.parse(str)
        if (entry && typeof entry.level === 'number') {
          logStream.ingest(entry)
        }
      } catch {
        // Not valid JSON — ignore (e.g. pino-pretty output)
      }
      return originalWrite(chunk, ...args)
    }

    this.pinoHookActive = true
    log.info('log collector hooked into AdonisJS logger (zero-config)')
  }

  async ready() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) return

    if (this.app.inTest && config.skipInTest !== false) return

    this.resolvedConfig = config

    let collectors: MetricCollector[]
    if (!config.collectors || config.collectors === 'auto') {
      const { autoDetectCollectors } = await import('../collectors/auto_detect.js')
      const result = await autoDetectCollectors()
      collectors = result.collectors
      log.info(`${bold(String(result.active))} of ${bold(String(result.total))} collectors active`)
    } else {
      collectors = config.collectors
    }
    this.resolvedCollectors = collectors
    this.engine = new StatsEngine(collectors)

    // Bind engine to container so the controller can access it
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'server_stats.engine',
      () => this.engine!
    )

    await this.engine.start()

    // Auto-hook log collector into the AdonisJS Pino logger (zero-config)
    await this.hookPinoLogger()

    // Create the stats controller (makes the stats route functional)
    const StatsControllerClass = (await import('../controller/server_stats_controller.js')).default
    this.statsController = new StatsControllerClass(this.engine)

    // Dev toolbar setup
    const toolbarConfig = config.devToolbar
    if (toolbarConfig?.enabled && !this.app.inProduction) {
      await this.setupDevToolbar({
        enabled: true,
        maxQueries: toolbarConfig.maxQueries ?? 500,
        maxEvents: toolbarConfig.maxEvents ?? 200,
        maxEmails: toolbarConfig.maxEmails ?? 100,
        slowQueryThresholdMs: toolbarConfig.slowQueryThresholdMs ?? 100,
        persistDebugData: toolbarConfig.persistDebugData ?? false,
        tracing: toolbarConfig.tracing ?? false,
        maxTraces: toolbarConfig.maxTraces ?? 200,
        dashboard: toolbarConfig.dashboard ?? false,
        dashboardPath: toolbarConfig.dashboardPath ?? '/__stats',
        retentionDays: toolbarConfig.retentionDays ?? 7,
        dbPath: toolbarConfig.dbPath ?? '.adonisjs/server-stats/dashboard.sqlite3',
        debugEndpoint: toolbarConfig.debugEndpoint ?? '/admin/api/debug',
      })

      // Exclude the stats endpoint and user-specified prefixes from tracing
      // so the debug panel's own polling doesn't flood the timeline
      const debugEndpoint = toolbarConfig.debugEndpoint ?? '/admin/api/debug'
      const defaultExcludes = [debugEndpoint, config.endpoint as string].filter(
        (p): p is string => typeof p === 'string'
      )
      const prefixes: string[] = [...(toolbarConfig.excludeFromTracing ?? defaultExcludes)]
      if (typeof config.endpoint === 'string' && !prefixes.includes(config.endpoint)) {
        prefixes.push(config.endpoint)
      }
      if (prefixes.length > 0) {
        setExcludedPrefixes(prefixes)
      }

      // Create the unified ApiController now that both stores are available
      if (this.debugStore) {
        const logPath = this.app.makePath('logs', 'adonisjs.log')
        const dataAccess = new DataAccess(this.debugStore, this.dashboardStore, logPath)
        const { ApiController: ApiControllerClass } =
          await import('../controller/api_controller.js')
        this.apiController = new ApiControllerClass(dataAccess)
      }
    }

    let transmit: unknown = null
    if (config.transport === 'transmit') {
      try {
        transmit = await this.app.container.make('transmit')
        if (transmit) {
          this.transmitAvailable = true
          if (config.channelName) {
            this.transmitChannels.push(config.channelName)
          }
        }
      } catch {
        log.info(
          'transport is "transmit" but @adonisjs/transmit is not installed — falling back to polling'
        )
      }
    }

    let prometheusCollector: unknown = null
    try {
      const mod = await import('../prometheus/prometheus_collector.js')
      prometheusCollector = mod.ServerStatsCollector.instance
    } catch {
      // Prometheus not installed — skip (optional dependency)
    }

    if (prometheusCollector) {
      this.prometheusActive = true
      log.info('Prometheus integration active')
    }

    this.intervalId = setInterval(async () => {
      try {
        const stats = await this.engine!.collect()

        if (transmit && config.channelName) {
          ;(transmit as { broadcast: Function }).broadcast(
            config.channelName,
            JSON.parse(JSON.stringify(stats))
          )
        }

        if (prometheusCollector) {
          ;(prometheusCollector as { update: Function }).update(stats)
        }

        config.onStats?.(stats)
      } catch {
        // Silently ignore collection errors
      }
    }, config.intervalMs)
  }

  private async setupDevToolbar(toolbarConfig: DevToolbarConfig) {
    this.debugStore = new DebugStore(toolbarConfig)

    // Bind debug store to container
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'debug.store',
      () => this.debugStore!
    )

    // Load persisted data before starting collectors
    if (toolbarConfig.persistDebugData) {
      this.persistPath =
        typeof toolbarConfig.persistDebugData === 'string'
          ? this.app.makePath(toolbarConfig.persistDebugData)
          : this.app.makePath('.adonisjs', 'server-stats', 'debug-data.json')
      await this.debugStore.loadFromDisk(this.persistPath)
    }

    // Get the emitter
    let emitter: unknown = null
    try {
      emitter = await this.app.container.make('emitter')
    } catch {
      log.warn('AdonisJS emitter not available — query and event collection will be disabled')
    }

    // Get the router
    let router: unknown = null
    try {
      router = await this.app.container.make('router')
    } catch {
      // Router not available
    }

    await this.debugStore.start(emitter, router)

    // Create the debug controller (makes the debug routes functional)
    const serverConfig = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    const DebugControllerClass = (await import('../controller/debug_controller.js')).default
    this.debugController = new DebugControllerClass(this.debugStore, serverConfig, {
      getEngine: () => this.engine,
      getDashboardStore: () => this.dashboardStore,
      getProviderDiagnostics: () => this.getDiagnostics(),
    })

    // Wire trace collector into the request tracking middleware
    if (this.debugStore.traces) {
      setTraceCollector(this.debugStore.traces)
    }

    // Periodic flush every 30 seconds (handles crashes)
    if (this.persistPath) {
      this.flushTimer = setInterval(async () => {
        try {
          await this.debugStore?.saveToDisk(this.persistPath!)
        } catch {
          // Silently ignore flush errors
        }
      }, 30_000)
    }

    // ── Transmit broadcasting for debug panel live updates ────────
    let debugTransmit: unknown = null
    try {
      debugTransmit = await this.app.container.make('transmit')
    } catch {
      // Transmit not installed — debug panel will use polling
    }

    if (debugTransmit) {
      this.transmitAvailable = true
      const debugChannel = 'server-stats/debug'
      if (!this.transmitChannels.includes(debugChannel)) {
        this.transmitChannels.push(debugChannel)
      }
      const pendingTypes = new Set<string>()
      this.debugStore.onNewItem((type) => {
        // Debounce: coalesce rapid events into a single broadcast
        pendingTypes.add(type)
        if (this.debugBroadcastTimer) return
        this.debugBroadcastTimer = setTimeout(() => {
          this.debugBroadcastTimer = null
          const types = Array.from(pendingTypes)
          pendingTypes.clear()
          try {
            ;(debugTransmit as { broadcast: Function }).broadcast(debugChannel, { types })
          } catch {
            // Silently ignore broadcast errors
          }
        }, 200)
      })
    }

    // Full-page dashboard setup (routes already registered in boot)
    if (toolbarConfig.dashboard) {
      await this.setupDashboard(toolbarConfig, emitter)
    }
  }

  /**
   * Initialize the full-page dashboard: SQLite store, controller,
   * log piping, and per-request data persistence.
   *
   * Routes are already registered in boot() with a lazy controller getter.
   * This method creates the controller so those routes become functional.
   */
  private async setupDashboard(toolbarConfig: DevToolbarConfig, emitter: unknown) {
    // Create and start the DashboardStore
    this.dashboardStore = new DashboardStore(toolbarConfig)
    const appRoot = this.app.makePath('')
    try {
      await this.dashboardStore.start(
        null,
        emitter as Parameters<DashboardStore['start']>[1],
        appRoot
      )
    } catch (err) {
      const msg = (err as Error)?.message || ''
      if (msg.includes('better-sqlite3') || msg.includes('Cannot find module')) {
        log.warn(
          'Dashboard requires better-sqlite3. Install it with:\n' +
            '  npm install better-sqlite3\n' +
            '  Dashboard has been disabled for this session.'
        )
        this.dashboardStore = null
        return
      }
      throw err
    }

    // Bind to container
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'dashboard.store',
      () => this.dashboardStore!
    )

    // Set dashboard path in middleware for self-exclusion
    setDashboardPath(toolbarConfig.dashboardPath)

    // Create the controller — this makes the routes registered in boot() functional
    const DashboardControllerClass = (await import('../dashboard/dashboard_controller.js')).default
    this.dashboardController = new DashboardControllerClass(this.dashboardStore, this.app)

    // ── Log piping ────────────────────────────────────────────────
    // If the log collector is already hooked into Pino (zero-config mode),
    // piggyback on it instead of creating a separate file poller.
    const existingLogStream = getLogStreamService()
    if (existingLogStream && !existingLogStream['logPath']) {
      // Stream mode — add a listener for dashboard persistence
      const origOnEntry = existingLogStream['onEntry']
      existingLogStream['onEntry'] = (entry: Record<string, unknown>) => {
        origOnEntry?.(entry)
        this.dashboardStore?.recordLog(entry)
      }
    } else {
      // File-based fallback
      const logPath = this.app.makePath('logs', 'adonisjs.log')
      this.dashboardLogStream = new LogStreamService(logPath, (entry) => {
        this.dashboardStore?.recordLog(entry)
      })
      await this.dashboardLogStream.start()
    }

    // ── Per-request data piping ────────────────────────────────────
    const debugStore = this.debugStore!
    const dashStore = this.dashboardStore

    let lastQueryId = 0
    let lastEventId = 0
    let warnedPersistOnce = false

    setOnRequestComplete(({ method, url, statusCode, duration, trace }) => {
      if (!dashStore.isReady()) return

      // Gather new queries since last request
      const allQueries = debugStore.queries.getQueries()
      const newQueries = allQueries.filter((q) => q.id > lastQueryId)
      if (allQueries.length > 0) {
        lastQueryId = allQueries[allQueries.length - 1].id
      }

      // Gather new events since last request
      const allEvents = debugStore.events.getEvents()
      const newEvents = allEvents.filter((e) => e.id > lastEventId)
      if (allEvents.length > 0) {
        lastEventId = allEvents[allEvents.length - 1].id
      }

      // Persist asynchronously (fire-and-forget)
      dashStore
        .persistRequest({
          method,
          url,
          statusCode,
          duration,
          queries: newQueries,
          trace: trace ?? null,
        })
        .then((requestId) => {
          if (requestId !== null && newEvents.length > 0) {
            return dashStore.recordEvents(requestId, newEvents)
          }
        })
        .catch((err) => {
          if (!warnedPersistOnce) {
            warnedPersistOnce = true
            log.warn('failed to persist request data — ' + (err?.message || 'unknown error'))
          }
        })
    })

    // ── Transmit streaming for real-time dashboard updates ────────
    let transmit: unknown = null
    try {
      transmit = await this.app.container.make('transmit')
    } catch {
      // Transmit not installed — skip real-time updates
    }

    if (transmit) {
      this.transmitAvailable = true
      const dashChannel = 'server-stats/dashboard'
      if (!this.transmitChannels.includes(dashChannel)) {
        this.transmitChannels.push(dashChannel)
      }
      this.dashboardBroadcastTimer = setInterval(async () => {
        try {
          if (!dashStore.isReady()) return
          const overview = await dashStore.getOverviewMetrics('1h')
          const diagnostics = {
            collectors: this.engine!.getCollectorHealth(),
            buffers: this.debugStore!.getBufferStats(),
          }
          ;(transmit as { broadcast: Function }).broadcast(dashChannel, {
            ...overview,
            diagnostics,
          })
        } catch {
          // Silently ignore
        }
      }, 5_000)
    }
  }

  /** Return diagnostics state for the Internals endpoint. */
  getDiagnostics() {
    const config = this.resolvedConfig
    const toolbarConfig = config?.devToolbar

    return {
      timers: {
        collectionInterval: {
          active: this.intervalId !== null,
          intervalMs: config?.intervalMs ?? 0,
        },
        dashboardBroadcast: {
          active: this.dashboardBroadcastTimer !== null,
          intervalMs: 5000,
        },
        debugBroadcast: {
          active: this.debugBroadcastTimer !== null,
          debounceMs: 200,
        },
        persistFlush: {
          active: this.flushTimer !== null,
          intervalMs: 30_000,
        },
        retentionCleanup: {
          active: this.dashboardStore?.isReady() ?? false,
          intervalMs: 60 * 60 * 1000,
        },
      },
      transmit: {
        available: this.transmitAvailable,
        channels: this.transmitChannels,
      },
      integrations: {
        prometheus: { active: this.prometheusActive },
        pinoHook: {
          active: this.pinoHookActive,
          mode: this.pinoHookActive ? 'stream' : toolbarConfig?.enabled ? 'none' : 'none',
        },
        edgePlugin: { active: this.edgePluginActive },
        cacheInspector: {
          available: this.resolvedCollectors.some((c) => c.name === 'redis'),
        },
        queueInspector: {
          available: this.resolvedCollectors.some((c) => c.name === 'queue'),
        },
      },
      config: {
        intervalMs: config?.intervalMs ?? 0,
        transport: config?.transport ?? 'none',
        channelName: config?.channelName ?? '',
        endpoint: config?.endpoint ?? false,
        skipInTest: config?.skipInTest !== false,
        hasOnStatsCallback: typeof config?.onStats === 'function',
        hasShouldShowCallback: typeof config?.shouldShow === 'function',
      },
      devToolbar: {
        enabled: !!toolbarConfig?.enabled,
        maxQueries: toolbarConfig?.maxQueries ?? 500,
        maxEvents: toolbarConfig?.maxEvents ?? 200,
        maxEmails: toolbarConfig?.maxEmails ?? 100,
        maxTraces: toolbarConfig?.maxTraces ?? 200,
        slowQueryThresholdMs: toolbarConfig?.slowQueryThresholdMs ?? 100,
        tracing: toolbarConfig?.tracing ?? false,
        dashboard: toolbarConfig?.dashboard ?? false,
        dashboardPath: toolbarConfig?.dashboardPath ?? '/__stats',
        debugEndpoint: toolbarConfig?.debugEndpoint ?? '/admin/api/debug',
        retentionDays: toolbarConfig?.retentionDays ?? 7,
        dbPath: toolbarConfig?.dbPath ?? '.adonisjs/server-stats/dashboard.sqlite3',
        persistDebugData: toolbarConfig?.persistDebugData ?? false,
        renderer: toolbarConfig?.renderer ?? 'preact',
        excludeFromTracing: toolbarConfig?.excludeFromTracing ?? [],
        customPaneCount: toolbarConfig?.panes?.length ?? 0,
      },
    }
  }

  async shutdown() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    if (this.dashboardBroadcastTimer) {
      clearInterval(this.dashboardBroadcastTimer)
      this.dashboardBroadcastTimer = null
    }

    if (this.debugBroadcastTimer) {
      clearTimeout(this.debugBroadcastTimer)
      this.debugBroadcastTimer = null
    }

    // Save debug data before stopping collectors
    if (this.persistPath && this.debugStore) {
      try {
        await this.debugStore.saveToDisk(this.persistPath)
      } catch (err) {
        log.warn('could not save debug data on shutdown — ' + (err as Error)?.message)
      }
    }

    // Clean up dashboard resources
    this.dashboardLogStream?.stop()
    setOnRequestComplete(null)
    setDashboardPath(null)
    setExcludedPrefixes([])
    await this.dashboardStore?.stop()

    this.debugStore?.stop()
    await this.engine?.stop()
  }
}

import { readFileSync } from 'node:fs'

import { getLogStreamService } from '../collectors/log_collector.js'
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
import { log, dim, bold, setVerbose } from '../utils/logger.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { ApiController } from '../controller/api_controller.js'
import type DebugController from '../controller/debug_controller.js'
import type ServerStatsController from '../controller/server_stats_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DashboardStore } from '../dashboard/dashboard_store.js'
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

  // Dashboard dependency check (set in boot, read in ready)
  private dashboardDepsAvailable: boolean = true

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
    try {
      await this.initializeBoot()
    } catch (err) {
      log.warn(
        `boot failed: ${(err as Error)?.message ?? err}\n` +
          `  ${dim('The server will continue without server-stats.')}`
      )
      if ((err as Error)?.stack) {
        console.error((err as Error).stack)
      }
    }
  }

  private async initializeBoot() {
    const config = this.app.config.get<ResolvedServerStatsConfig>('server_stats')
    if (!config) {
      log.warn('no config found — is config/server_stats.ts set up?')
      return
    }

    // Re-apply verbose setting from resolved config so the logger
    // respects it even if defineConfig() ran in a separate context.
    setVerbose(config.verbose)

    log.info('booting...')

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

      // Check dashboard dependencies before registering dashboard routes.
      // Must use appImport — bare import() resolves to this package's
      // devDeps when symlinked, not the app's actual dependencies.
      if (toolbarConfig?.enabled && toolbarConfig.dashboard) {
        const { appImport } = await import('../utils/app_import.js')
        const missing: string[] = []
        try {
          await appImport('knex')
        } catch {
          missing.push('knex')
        }
        try {
          await appImport('better-sqlite3')
        } catch {
          missing.push('better-sqlite3')
        }
        if (missing.length > 0) {
          this.dashboardDepsAvailable = false
          log.block(`Dashboard requires ${missing.join(' and ')}. Install with:`, [
            '',
            bold(`npm install ${missing.join(' ')}`),
            '',
            dim('Dashboard routes have been skipped for now.'),
            dim('Everything else (stats bar, debug panel) works without it.'),
          ])
        }
      }

      const dashboardPath =
        toolbarConfig?.enabled && toolbarConfig.dashboard && this.dashboardDepsAvailable
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
        log.list('routes auto-registered (no manual setup needed):', registeredPaths)

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
      // Must use appImport for edge.js — when this package is symlinked,
      // bare import('edge.js') resolves to the package's devDep copy,
      // which is a different singleton than the app's Edge instance.
      const { appImport } = await import('../utils/app_import.js')
      const edge = await appImport<typeof import('edge.js')>('edge.js')
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

    // Defer the entire initialization to setImmediate so ready() returns
    // immediately. AdonisJS waits for all provider ready() hooks before
    // processing HTTP requests — blocking here would hang the server.
    // Routes use lazy controller getters that return 503 until init completes.
    setImmediate(() => {
      this.initializeServerStats(config).catch((err) => {
        log.warn(
          `failed to initialize: ${(err as Error)?.message ?? err}\n` +
            `  ${dim('The server will continue without server-stats.')}`
        )
        if ((err as Error)?.stack) {
          console.error((err as Error).stack)
        }
      })
    })
  }

  private async initializeServerStats(config: ResolvedServerStatsConfig) {
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
      try {
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
      } catch (err) {
        log.warn(
          `dev toolbar setup failed: ${(err as Error)?.message ?? err}\n` +
            `  ${dim('Stats bar will still work, but debug panel may be unavailable.')}`
        )
      }

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

      // Create the unified ApiController now that debug store is available.
      // Dashboard store is passed as a getter so it picks up the reference
      // once setupDashboard() completes asynchronously.
      if (this.debugStore) {
        const logPath = this.app.makePath('logs', 'adonisjs.log')
        const { DataAccess: DataAccessClass } = await import('../data/data_access.js')
        const dataAccess = new DataAccessClass(this.debugStore, () => this.dashboardStore, logPath)
        const { ApiController: ApiControllerClass } =
          await import('../controller/api_controller.js')
        this.apiController = new ApiControllerClass(dataAccess)
      }
    }

    // ── Stats collection interval + transmit (lightweight, set up inline) ──
    this.setupStatsInterval(config)

    log.info('ready')
  }

  /**
   * Set up the stats collection interval, transmit broadcasting,
   * and Prometheus integration. Extracted from initializeServerStats
   * so the ready log fires promptly.
   */
  private setupStatsInterval(config: ResolvedServerStatsConfig) {
    let transmit: unknown = null
    let prometheusCollector: unknown = null

    // Resolve transmit + prometheus asynchronously but don't block ready()
    const resolveIntegrations = async () => {
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
    }

    resolveIntegrations().catch(() => {})

    this.intervalId = setInterval(async () => {
      try {
        const stats = await this.engine!.collect()

        if (transmit && config.channelName) {
          ;(transmit as { broadcast: Function }).broadcast(config.channelName, stats)
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
      getApp: () => this.app,
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

    // Full-page dashboard setup — deferred with setImmediate so it runs
    // AFTER the current event-loop cycle completes. This guarantees
    // ready() returns and AdonisJS can process HTTP requests while the
    // SQLite store initializes in the background.
    if (toolbarConfig.dashboard && this.dashboardDepsAvailable) {
      setImmediate(() => {
        this.setupDashboard(toolbarConfig, emitter).catch((err) => {
          log.warn(
            `dashboard setup failed: ${(err as Error)?.message ?? err}\n` +
              `  ${dim('Everything else continues to work.')}`
          )
        })
      })
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
    log.info('dashboard: initializing SQLite store...')
    // Dynamically import DashboardStore so knex/better-sqlite3 are truly optional
    const { DashboardStore: DashboardStoreClass } = await import('../dashboard/dashboard_store.js')
    this.dashboardStore = new DashboardStoreClass(toolbarConfig)
    const appRoot = this.app.makePath('')
    try {
      // Timeout safety net: if SQLite init hangs (e.g. wrong native binary
      // loaded via symlink), abort after 15s instead of freezing forever.
      const TIMEOUT_MS = 15_000
      const startPromise = this.dashboardStore.start(
        null,
        emitter as Parameters<DashboardStore['start']>[1],
        appRoot
      )
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(`Dashboard SQLite initialization timed out after ${TIMEOUT_MS / 1000}s`)
            ),
          TIMEOUT_MS
        )
      })
      await Promise.race([startPromise, timeoutPromise])
      log.info('dashboard: SQLite store ready')
    } catch (err) {
      const msg = (err as Error)?.message || ''
      const code = (err as NodeJS.ErrnoException)?.code || ''
      const isMissingDep =
        msg.includes('better-sqlite3') ||
        msg.includes('knex') ||
        msg.includes('Cannot find module') ||
        msg.includes('Cannot find package') ||
        code === 'ERR_MODULE_NOT_FOUND' ||
        code === 'MODULE_NOT_FOUND'
      const isTimeout = msg.includes('timed out')

      if (isMissingDep) {
        log.block('Dashboard could not start — missing dependencies. Install with:', [
          '',
          bold('npm install knex better-sqlite3'),
          '',
          dim('Dashboard has been disabled for this session.'),
          dim('Everything else (stats bar, debug panel) works without it.'),
        ])
      } else if (isTimeout) {
        log.block('Dashboard initialization timed out', [
          dim('SQLite setup took too long — this usually means a wrong native'),
          dim('binary was loaded (common with symlinked/file: dependencies).'),
          '',
          dim('Try running:'),
          `  ${bold('npm install knex better-sqlite3')}`,
          dim('in your app directory to ensure the correct copies are used.'),
          '',
          dim('Dashboard has been disabled for this session.'),
          dim('Everything else (stats bar, debug panel) works without it.'),
        ])
      } else {
        log.warn(
          `Dashboard could not start: ${msg}\n` +
            `  ${dim('Dashboard has been disabled for this session.')}`
        )
        if ((err as Error)?.stack) {
          console.error((err as Error).stack)
        }
      }
      this.dashboardStore = null
      return
    }

    log.info('dashboard: binding to container...')

    // Bind to container
    ;(this.app.container as unknown as ContainerWithSingleton).singleton(
      'dashboard.store',
      () => this.dashboardStore!
    )

    // Set dashboard path in middleware for self-exclusion
    setDashboardPath(toolbarConfig.dashboardPath)

    // Create the controller — this makes the routes registered in boot() functional
    log.info('dashboard: creating controller...')
    const DashboardControllerClass = (await import('../dashboard/dashboard_controller.js')).default
    this.dashboardController = new DashboardControllerClass(this.dashboardStore, this.app)

    // ── Log piping ────────────────────────────────────────────────
    // If the log collector is already hooked into Pino (zero-config mode),
    // piggyback on it instead of creating a separate file poller.
    log.info('dashboard: setting up log piping...')
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

    setOnRequestComplete(({ method, url, statusCode, duration, trace }) => {
      if (!dashStore.isReady()) return

      // O(K) collection of new queries since last seen ID — avoids
      // copying the entire 500-item ring buffer on every request.
      const newQueries = debugStore.queries.getQueriesSince(lastQueryId)
      if (newQueries.length > 0) {
        lastQueryId = newQueries[newQueries.length - 1].id
      }

      // Queue for batch persistence (flushed every 500ms)
      dashStore.persistRequest({
        method,
        url,
        statusCode,
        duration,
        queries: newQueries,
        trace: trace ?? null,
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
      // Broadcast overview metrics every 30s (not 5s) to reduce SQLite
      // pool pressure. Each broadcast runs 5+ sequential queries on the
      // single-connection pool, blocking all dashboard API reads.
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
      }, 30_000)
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
          intervalMs: 30_000,
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

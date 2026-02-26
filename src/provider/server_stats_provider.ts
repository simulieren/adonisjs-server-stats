import { registerDashboardRoutes } from '../dashboard/dashboard_routes.js'
import { DashboardStore } from '../dashboard/dashboard_store.js'
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

import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DevToolbarConfig } from '../debug/types.js'
import type { ServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

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

  constructor(protected app: ApplicationService) {}

  async boot() {
    const config = this.app.config.get<ServerStatsConfig>('server_stats')
    if (!config) return

    // Wire up the per-request shouldShow callback
    if (config.shouldShow) {
      setShouldShow(config.shouldShow)
    }

    // Register dashboard routes early (before router commits).
    // The controller is created later in ready() — routes use a lazy getter.
    const toolbarConfig = config.devToolbar
    if (toolbarConfig?.enabled && toolbarConfig.dashboard && !this.app.inProduction) {
      try {
        const router = await this.app.container.make('router')
        const dashPath = toolbarConfig.dashboardPath ?? '/__stats'

        registerDashboardRoutes(router, dashPath, () => this.dashboardController, config.shouldShow)
      } catch {
        // Router not available — skip route registration
      }
    }

    if (!this.app.usingEdgeJS) return

    try {
      const edge = await import('edge.js')
      const { edgePluginServerStats } = await import('../edge/plugin.js')
      edge.default.use(edgePluginServerStats(config))
    } catch {
      // Edge not available — skip tag registration
    }
  }

  async ready() {
    const config = this.app.config.get<ServerStatsConfig>('server_stats')
    if (!config) return

    if (this.app.inTest && config.skipInTest !== false) return

    this.engine = new StatsEngine(config.collectors)

    // Bind engine to container so the controller can access it
    ;(this.app.container as any).singleton('server_stats.engine', () => this.engine!)

    await this.engine.start()

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
      })

      // Exclude the stats endpoint and user-specified prefixes from tracing
      // so the debug panel's own polling doesn't flood the timeline
      const defaultExcludes = ['/admin/api/debug', '/admin/api/server-stats']
      const prefixes: string[] = [...(toolbarConfig.excludeFromTracing ?? defaultExcludes)]
      if (typeof config.endpoint === 'string') {
        prefixes.push(config.endpoint)
      }
      if (prefixes.length > 0) {
        setExcludedPrefixes(prefixes)
      }
    }

    let transmit: any = null
    if (config.transport === 'transmit') {
      try {
        transmit = await this.app.container.make('transmit')
      } catch {
        // Transmit not installed — skip broadcasting
      }
    }

    let prometheusCollector: any = null
    try {
      const mod = await import('../prometheus/prometheus_collector.js')
      prometheusCollector = mod.ServerStatsCollector.instance
    } catch {
      // Prometheus not installed — skip
    }

    this.intervalId = setInterval(async () => {
      try {
        const stats = await this.engine!.collect()

        if (transmit && config.channelName) {
          transmit.broadcast(config.channelName, JSON.parse(JSON.stringify(stats)))
        }

        if (prometheusCollector) {
          prometheusCollector.update(stats)
        }

        config.onStats?.(stats as any)
      } catch {
        // Silently ignore collection errors
      }
    }, config.intervalMs)
  }

  private async setupDevToolbar(toolbarConfig: DevToolbarConfig) {
    this.debugStore = new DebugStore(toolbarConfig)

    // Bind debug store to container
    ;(this.app.container as any).singleton('debug.store', () => this.debugStore!)

    // Load persisted data before starting collectors
    if (toolbarConfig.persistDebugData) {
      this.persistPath =
        typeof toolbarConfig.persistDebugData === 'string'
          ? this.app.makePath(toolbarConfig.persistDebugData)
          : this.app.makePath('.adonisjs', 'server-stats', 'debug-data.json')
      await this.debugStore.loadFromDisk(this.persistPath)
    }

    // Get the emitter
    let emitter: any = null
    try {
      emitter = await this.app.container.make('emitter')
    } catch {
      // Emitter not available
    }

    // Get the router
    let router: any = null
    try {
      router = await this.app.container.make('router')
    } catch {
      // Router not available
    }

    await this.debugStore.start(emitter, router)

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
    let debugTransmit: any = null
    try {
      debugTransmit = await this.app.container.make('transmit')
    } catch {
      // Transmit not installed — debug panel will use polling
    }

    if (debugTransmit) {
      const debugChannel = 'server-stats/debug'
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
            debugTransmit.broadcast(debugChannel, { types })
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
  private async setupDashboard(toolbarConfig: DevToolbarConfig, emitter: any) {
    // Create and start the DashboardStore
    this.dashboardStore = new DashboardStore(toolbarConfig)
    const appRoot = this.app.makePath('')
    try {
      await this.dashboardStore.start(null, emitter, appRoot)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('better-sqlite3') || msg.includes('Cannot find module')) {
        console.warn(
          '[server-stats] Dashboard requires better-sqlite3. Install it with:\n' +
            '  npm install better-sqlite3\n' +
            'Dashboard has been disabled for this session.'
        )
        this.dashboardStore = null
        return
      }
      throw err
    }

    // Bind to container
    ;(this.app.container as any).singleton('dashboard.store', () => this.dashboardStore!)

    // Set dashboard path in middleware for self-exclusion
    setDashboardPath(toolbarConfig.dashboardPath)

    // Create the controller — this makes the routes registered in boot() functional
    const DashboardControllerClass = (await import('../dashboard/dashboard_controller.js')).default
    this.dashboardController = new DashboardControllerClass(
      this.dashboardStore,
      this.debugStore!,
      this.app
    )

    // ── Log piping ────────────────────────────────────────────────
    const logPath = this.app.makePath('logs', 'adonisjs.log')
    this.dashboardLogStream = new LogStreamService(logPath, (entry) => {
      this.dashboardStore?.recordLog(entry)
    })
    await this.dashboardLogStream.start()

    // ── Per-request data piping ────────────────────────────────────
    const debugStore = this.debugStore!
    const dashStore = this.dashboardStore

    let lastQueryId = 0
    let lastEventId = 0

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
        .persistRequest(method, url, statusCode, duration, newQueries, trace ?? null)
        .then((requestId) => {
          if (requestId !== null && newEvents.length > 0) {
            return dashStore.recordEvents(requestId, newEvents)
          }
        })
        .catch(() => {
          // Silently ignore persistence errors
        })
    })

    // ── Transmit streaming for real-time dashboard updates ────────
    let transmit: any = null
    try {
      transmit = await this.app.container.make('transmit')
    } catch {
      // Transmit not installed — skip real-time updates
    }

    if (transmit) {
      const dashChannel = 'server-stats/dashboard'
      this.dashboardBroadcastTimer = setInterval(async () => {
        try {
          if (!dashStore.isReady()) return
          const overview = await dashStore.getOverviewMetrics('1h')
          transmit.broadcast(dashChannel, overview)
        } catch {
          // Silently ignore
        }
      }, 5_000)
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
      } catch {
        // Silently ignore save errors during shutdown
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

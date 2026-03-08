/**
 * Additional provider helper functions extracted from ServerStatsProvider.
 */

import { getLogStreamService } from '../collectors/log_collector.js'
import { LogStreamService } from '../log_stream/log_stream_service.js'
import {
  setDashboardPath,
  setOnRequestComplete,
} from '../middleware/request_tracking_middleware.js'
import { log, dim, bold } from '../utils/logger.js'
import { detectGlobalAuthMiddleware } from './auth_middleware_detector.js'
import { classifyDashboardError, createStartTimeout } from './dashboard_setup.js'
import { setupFullEmailBridge } from './email_bridge.js'
import { findPinoStreamSymbol, wrapWriteMethod } from './pino_hook.js'
import {
  resolveTransmitFromContainer,
  resolvePrometheusCollector,
  createCollectionInterval,
} from './stats_interval.js'
import { wireDebugTransmitBroadcast } from './toolbar_setup.js'

import type DebugController from '../controller/debug_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { DevToolbarConfig } from '../debug/types.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

/** Hook the AdonisJS Pino logger into the log collector. Returns true if hooked. */
export function hookPinoToLogStream(logger: unknown): boolean {
  const logStream = getLogStreamService()
  if (!logStream) return false
  const pino = (logger as Record<string, unknown> | null)?.pino
  if (!pino) return false
  const streamSym = findPinoStreamSymbol(pino as object)
  if (!streamSym) return false
  const rawStream = (pino as Record<symbol, unknown>)[streamSym]
  if (!rawStream || typeof (rawStream as Record<string, unknown>).write !== 'function') return false
  wrapWriteMethod(rawStream as { write: Function; [key: string]: unknown }, (entry) =>
    logStream.ingest(entry)
  )
  log.info('log collector hooked into AdonisJS logger (zero-config)')
  return true
}

/** Set up log stream broadcasting via Transmit. Returns LogStreamService if file-based fallback. */
export function setupLogStreamBroadcast(
  transmit: { broadcast(ch: string, d: unknown): void },
  channelName: string,
  pinoHookActive: boolean,
  makePath: (...parts: string[]) => string
): LogStreamService | null {
  const broadcast = (entry: Record<string, unknown>) => {
    try {
      transmit.broadcast(channelName, entry)
    } catch {}
  }
  const existing = getLogStreamService()
  if (pinoHookActive && existing) {
    const internal = existing as unknown as { onEntry?: (entry: Record<string, unknown>) => void }
    const orig = internal.onEntry
    internal.onEntry = (entry: Record<string, unknown>) => {
      orig?.(entry)
      broadcast(entry)
    }
    return null
  }
  const service = new LogStreamService(makePath('logs', 'adonisjs.log'), broadcast)
  service.start().catch(() => {})
  return service
}

/** Warn about global auth middleware if shouldShow is not configured. */
export function warnAboutGlobalAuth(
  config: ResolvedServerStatsConfig,
  makePath: (dir: string, file: string) => string
): void {
  if (config.shouldShow) return
  const mw = detectGlobalAuthMiddleware(makePath)
  if (mw.length === 0) return
  log.block(bold('found global auth middleware that will run on every poll:'), [
    ...mw.map((m) => `${dim('→')} ${m}`),
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

/** Resolve Redis for the email bridge via appImport. */
export async function resolveRedisForBridge(): Promise<{
  publish(ch: string, msg: string): Promise<unknown>
  subscribe?(ch: string, h: (msg: string) => void): unknown
} | null> {
  try {
    const { appImport } = await import('../utils/app_import.js')
    const mod = await appImport<typeof import('@adonisjs/redis/services/main')>(
      '@adonisjs/redis/services/main'
    )
    return mod.default as {
      publish(ch: string, msg: string): Promise<unknown>
      subscribe?(ch: string, h: (msg: string) => void): unknown
    }
  } catch {
    return null
  }
}

/** Create the DebugController instance. */
export async function createDebugController(
  debugStore: DebugStore,
  config: ResolvedServerStatsConfig,
  deps: {
    getEngine: () => unknown
    getDashboardStore: () => unknown
    getProviderDiagnostics: () => unknown
    getApp: () => unknown
  }
): Promise<DebugController> {
  const Cls = (await import('../controller/debug_controller.js')).default
  return new Cls(debugStore, config, deps)
}

/** Set up debug broadcast via Transmit. Returns broadcast helpers or null. */
export async function setupDebugBroadcastHelper(
  debugStore: DebugStore,
  transmit: unknown
): Promise<{ getTimer: () => ReturnType<typeof setTimeout> | null; channels: string[] } | null> {
  if (!transmit || !debugStore) return null
  const ch = 'server-stats/debug'
  const b = wireDebugTransmitBroadcast(
    debugStore,
    transmit as { broadcast(c: string, d: unknown): void },
    ch
  )
  return { getTimer: b.getTimer, channels: [ch] }
}

/** Set up the full email bridge (publish + subscribe). Returns redis or null. */
export async function setupEmailBridgeFromProvider(
  emitter: unknown,
  channel: string,
  debugStore: DebugStore | null,
  dashboardStore: DashboardStore | null
): Promise<unknown> {
  if (!emitter) return null
  const redis = await resolveRedisForBridge()
  if (!redis || !redis.subscribe) return null
  const result = await setupFullEmailBridge(
    emitter as { on(e: string, h: (...a: unknown[]) => void): void },
    redis as {
      publish(c: string, m: string): Promise<unknown>
      subscribe(c: string, h: (m: string) => void): unknown
    },
    channel,
    { debugEmails: debugStore?.emails ?? null, dashboardStore }
  )
  return result ? redis : null
}

interface DashboardResult {
  dashboardStore: DashboardStore | null
  dashboardController: DashboardController | null
  dashboardLogStream: LogStreamService | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
}

/** Initialize the full-page dashboard: SQLite store, controller, log piping, broadcasting. */
export async function initDashboardStore(
  toolbarConfig: DevToolbarConfig,
  emitter: unknown,
  app: ApplicationService,
  debugStore: DebugStore,
  engine: StatsEngine,
  pinoHookActive: boolean,
  transmitChannels: string[],
  onResult: (r: DashboardResult) => void
): Promise<void> {
  log.info('dashboard: initializing SQLite store...')
  const { DashboardStore: DashboardStoreClass } = await import('../dashboard/dashboard_store.js')
  const dashboardStore = new DashboardStoreClass(toolbarConfig)
  try {
    await createStartTimeout(
      dashboardStore.start(
        null,
        emitter as Parameters<DashboardStore['start']>[1],
        app.makePath('')
      ),
      15_000
    )
    log.info('dashboard: SQLite store ready')
  } catch (err) {
    logDashboardStartError(err)
    onResult({
      dashboardStore: null,
      dashboardController: null,
      dashboardLogStream: null,
      dashboardBroadcastTimer: null,
    })
    return
  }
  const container = app.container as unknown as {
    singleton(b: string, f: () => unknown): void
    make(b: string): Promise<unknown>
  }
  container.singleton('dashboard.store', () => dashboardStore)
  setDashboardPath(toolbarConfig.dashboardPath)
  const DashboardControllerClass = (await import('../dashboard/dashboard_controller.js')).default
  const dashboardController = new DashboardControllerClass(dashboardStore, app)
  const dashboardLogStream = setupDashboardLogPipingHelper(
    pinoHookActive,
    dashboardStore,
    app.makePath.bind(app)
  )
  setupDashboardRequestPipingHelper(debugStore, dashboardStore)
  let transmit: unknown = null
  try {
    transmit = await container.make('transmit')
  } catch {}
  let dashboardBroadcastTimer: ReturnType<typeof setInterval> | null = null
  if (transmit) {
    const ch = 'server-stats/dashboard'
    if (!transmitChannels.includes(ch)) transmitChannels.push(ch)
    dashboardBroadcastTimer = setInterval(async () => {
      try {
        if (!dashboardStore.isReady()) return
        const o = await dashboardStore.getOverviewMetrics('1h')
        ;(transmit as { broadcast: Function }).broadcast(ch, {
          ...o,
          diagnostics: {
            collectors: engine.getCollectorHealth(),
            buffers: debugStore.getBufferStats(),
          },
        })
      } catch {}
    }, 30_000)
  }
  onResult({ dashboardStore, dashboardController, dashboardLogStream, dashboardBroadcastTimer })
}

function setupDashboardLogPipingHelper(
  pinoHookActive: boolean,
  dashboardStore: DashboardStore,
  makePath: (...parts: string[]) => string
): LogStreamService | null {
  const existing = getLogStreamService()
  if (pinoHookActive && existing && !existing['logPath']) {
    const orig = existing['onEntry']
    existing['onEntry'] = (entry: Record<string, unknown>) => {
      orig?.(entry)
      dashboardStore.recordLog(entry)
    }
    return null
  }
  const service = new LogStreamService(makePath('logs', 'adonisjs.log'), (entry) => {
    dashboardStore.recordLog(entry)
  })
  service.start().catch(() => {})
  return service
}

function setupDashboardRequestPipingHelper(
  debugStore: DebugStore,
  dashboardStore: DashboardStore
): void {
  let lastQueryId = 0
  setOnRequestComplete(({ method, url, statusCode, duration, trace, httpRequestId }) => {
    if (!dashboardStore.isReady()) return
    const q = debugStore.queries.getQueriesSince(lastQueryId)
    if (q.length > 0) lastQueryId = q[q.length - 1].id
    dashboardStore.persistRequest({
      method,
      url,
      statusCode,
      duration,
      queries: q,
      trace: trace ?? null,
      httpRequestId: httpRequestId ?? null,
    })
  })
}

function logDashboardStartError(err: unknown): void {
  const c = classifyDashboardError(err)
  if (c === 'missing-dep') {
    log.block('Dashboard could not start — missing dependencies. Install with:', [
      '',
      bold('npm install knex better-sqlite3'),
      '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
  } else if (c === 'timeout') {
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
      `Dashboard could not start: ${(err as Error)?.message ?? ''}\n  ${dim('Dashboard has been disabled for this session.')}`
    )
    if ((err as Error)?.stack) console.error((err as Error).stack)
  }
}

interface StatsIntervalResult {
  intervalId: ReturnType<typeof setInterval>
  transmitAvailable: boolean
  prometheusActive: boolean
  channelName: string | null
}

/** Set up the stats collection interval with transmit and prometheus integration. */
export async function setupStatsIntervalHelper(
  engine: StatsEngine,
  config: ResolvedServerStatsConfig,
  container: { make(b: string): Promise<unknown> }
): Promise<StatsIntervalResult> {
  let transmitAvailable = false
  let prometheusActive = false
  const transmit = await resolveTransmitFromContainer(container, config.transport)
  if (transmit) transmitAvailable = true
  const prom = await resolvePrometheusCollector()
  if (prom) prometheusActive = true
  const intervalId = createCollectionInterval(engine, config.intervalMs, {
    transmit: transmit as { broadcast(c: string, d: unknown): void } | null,
    channelName: config.channelName,
    prometheusCollector: prom as { update(s: unknown): void } | null,
    onStats: config.onStats,
  })
  return {
    intervalId,
    transmitAvailable,
    prometheusActive,
    channelName: transmitAvailable ? config.channelName : null,
  }
}

/**
 * Dashboard initialization helpers extracted from toolbar_setup.
 * Handles SQLite store creation, log piping, request piping, and broadcasting.
 */

import { getLogStreamService } from '../collectors/log_collector.js'
import { LogStreamService } from '../log_stream/log_stream_service.js'
import {
  setDashboardPath,
  setOnRequestComplete,
} from '../middleware/request_tracking_middleware.js'
import { log, dim, bold } from '../utils/logger.js'
import { classifyDashboardError, createStartTimeout } from './dashboard_setup.js'

import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { DevToolbarConfig } from '../debug/types.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { ApplicationService } from '@adonisjs/core/types'

// ── initDashboardStore ──────────────────────────────────────────

interface DashboardResult {
  dashboardStore: DashboardStore | null
  dashboardController: DashboardController | null
  dashboardLogStream: LogStreamService | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
}

interface DashboardStoreOptions {
  tc: DevToolbarConfig
  emitter: unknown
  app: ApplicationService
  debugStore: DebugStore
  engine: StatsEngine
  pinoHookActive: boolean
  transmitChannels: string[]
  onResult: (r: DashboardResult) => void
}

/** Initialize the full-page dashboard: SQLite store, controller, log piping, broadcasting. */
export async function initDashboardStore(opts: DashboardStoreOptions): Promise<void> {
  const { tc, emitter, app, debugStore, engine, pinoHookActive, transmitChannels, onResult } = opts
  log.info('dashboard: initializing SQLite store...')
  const { DashboardStore: DSC } = await import('../dashboard/dashboard_store.js')
  const dashboardStore = new DSC(tc)
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
    const errMsg = (err as Error)?.message ?? String(err)
    const errStack = (err as Error)?.stack ?? '(no stack)'
    // Write to file since console.error may be swallowed by AdonisJS watcher
    try {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        app.makePath('server-stats-dashboard-error.log'),
        `${new Date().toISOString()}\nError: ${errMsg}\nStack: ${errStack}\n`
      )
    } catch {}
    console.error('[server-stats] dashboard start error:', errMsg)
    console.error('[server-stats] dashboard start stack:', errStack)
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
  setDashboardPath(tc.dashboardPath)
  const DCC = (await import('../dashboard/dashboard_controller.js')).default
  const dashboardController = new DCC(dashboardStore, app)
  // Log capture is a separate opt-in: it is high-volume and log lines routinely
  // carry request payloads. With it off the dashboard's other panes still work.
  const dashboardLogStream =
    tc.capture?.logs !== false
      ? pipeDashLogs(pinoHookActive, dashboardStore, app.makePath.bind(app))
      : null
  pipeDashRequests(debugStore, dashboardStore)
  const dashboardBroadcastTimer = await setupDashBroadcast({
    container,
    dashboardStore,
    engine,
    debugStore,
    transmitChannels,
  })
  onResult({ dashboardStore, dashboardController, dashboardLogStream, dashboardBroadcastTimer })
}

interface DashBroadcastDeps {
  container: { make(b: string): Promise<unknown> }
  dashboardStore: DashboardStore
  engine: StatsEngine
  debugStore: DebugStore
  transmitChannels: string[]
}

async function setupDashBroadcast(
  deps: DashBroadcastDeps
): Promise<ReturnType<typeof setInterval> | null> {
  const { container, dashboardStore, engine, debugStore, transmitChannels } = deps
  let transmit: unknown = null
  try {
    transmit = await container.make('transmit')
  } catch {}
  if (!transmit) return null
  const ch = 'server-stats/dashboard'
  if (!transmitChannels.includes(ch)) transmitChannels.push(ch)
  return setInterval(async () => {
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

function pipeDashLogs(
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

/**
 * Whether this module has already installed the request-completion handler.
 * `setOnRequestComplete` is a single-slot setter, so a second `initDashboardStore`
 * (hot-reload / test restart) would silently clobber the first handler — and its
 * `lastQueryId`/`dashboardStore` closure — leaving requests attributed to a stale
 * store. We install once and warn on any later attempt. There is only ever one
 * dashboard request pipe, so accumulating handlers would just double-persist.
 */
let dashRequestPipeInstalled = false

function pipeDashRequests(debugStore: DebugStore, dashboardStore: DashboardStore): void {
  if (dashRequestPipeInstalled) {
    log.warn(
      'dashboard: request pipe already installed — ignoring duplicate registration ' +
        '(likely a hot-reload/re-init). Restart the process for a clean state.'
    )
    return
  }
  dashRequestPipeInstalled = true
  let lastQueryId = 0
  let lastEventId = 0
  setOnRequestComplete(({ method, url, statusCode, duration, trace, httpRequestId }) => {
    if (!dashboardStore.isReady()) return
    const q = debugStore.queries.getQueriesSince(lastQueryId)
    if (q.length > 0) lastQueryId = q[q.length - 1].id
    // Events are collected globally rather than per-request, so — exactly like
    // queries above — anything emitted outside a request is attributed to
    // whichever request finishes next. Imprecise, but it keeps events linked to
    // a request row, which is what retention prunes on.
    const events = debugStore.capture.events ? debugStore.events.getEventsSince(lastEventId) : []
    if (events.length > 0) lastEventId = events[events.length - 1].id
    dashboardStore.persistRequest({
      method,
      url,
      statusCode,
      duration,
      queries: q,
      events,
      trace: trace ?? null,
      httpRequestId: httpRequestId ?? null,
    })
  })
}

function logDashboardStartError(err: unknown): void {
  const errMsg = (err as Error)?.message ?? String(err)
  const c = classifyDashboardError(err)
  if (c === 'missing-dep') {
    log.block('Dashboard could not start — missing dependencies. Install with:', [
      '',
      bold('npm install knex better-sqlite3'),
      '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
      '',
      dim(`Error: ${errMsg}`),
    ])
    if ((err as Error)?.stack) console.error((err as Error).stack)
    return
  }
  if (c === 'timeout') {
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
    return
  }
  log.warn(
    `Dashboard could not start: ${(err as Error)?.message ?? ''}\n  ${dim('Dashboard has been disabled for this session.')}`
  )
  if ((err as Error)?.stack) console.error((err as Error).stack)
}

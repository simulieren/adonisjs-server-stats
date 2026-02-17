import type { MetricCollector } from './collectors/collector.js'
import type { DebugPane } from './debug/types.js'

/**
 * Primitive value types that collectors can return.
 *
 * Every field in a {@link ServerStats} snapshot is one of these types.
 * Custom collectors must also return records of these values.
 */
export type MetricValue = string | number | boolean

// ---------------------------------------------------------------------------
// Stats snapshot
// ---------------------------------------------------------------------------

/**
 * A point-in-time snapshot of all server metrics.
 *
 * Produced by {@link StatsEngine.collect} each tick and broadcast to clients
 * via Transmit (SSE) or polled via the HTTP endpoint.
 *
 * Each collector contributes a subset of these fields. Fields will be `0`,
 * `false`, or `''` when the responsible collector is not configured or when
 * the underlying service is unavailable.
 */
export interface ServerStats {
  // -- Process ---------------------------------------------------------------

  /** Node.js version string (e.g. `"v20.11.0"`). */
  nodeVersion: string

  /** Process uptime in **seconds**. */
  uptime: number

  /** V8 heap memory currently in use, in **bytes**. */
  memHeapUsed: number

  /** V8 heap memory allocated (committed), in **bytes**. */
  memHeapTotal: number

  /**
   * Resident Set Size in **bytes**.
   *
   * Total OS memory footprint of the process, including heap, stack,
   * and native allocations.
   */
  memRss: number

  /**
   * CPU usage as a percentage of **one** CPU core (0 -- 100).
   *
   * Measured as the ratio of user + system CPU time to wall-clock time
   * since the last collection tick.
   */
  cpuPercent: number

  /**
   * Event loop latency in **milliseconds**.
   *
   * Mean delay between a timer's scheduled execution time and its actual
   * execution time, sampled via `monitorEventLoopDelay`.
   *
   * | Range    | Meaning                      |
   * |----------|------------------------------|
   * | < 20 ms  | Healthy                      |
   * | 20-50 ms | Under load (amber threshold) |
   * | > 50 ms  | Blocked (red threshold)      |
   */
  eventLoopLag: number

  /** Unix timestamp in **milliseconds** when this snapshot was taken. */
  timestamp: number

  // -- HTTP ------------------------------------------------------------------

  /**
   * HTTP requests per second over the rolling window.
   *
   * Defaults to a 60-second window; configurable via
   * `httpCollector({ windowMs })`.
   */
  requestsPerSecond: number

  /**
   * Average HTTP response time in **milliseconds** over the rolling window.
   *
   * | Range     | Meaning                      |
   * |-----------|------------------------------|
   * | < 200 ms  | Healthy                      |
   * | 200-500ms | Slow (amber threshold)       |
   * | > 500 ms  | Critical (red threshold)     |
   */
  avgResponseTimeMs: number

  /**
   * Server error rate as a **percentage** (0 -- 100).
   *
   * Ratio of 5xx responses to total responses in the rolling window.
   *
   * | Range | Meaning                      |
   * |-------|------------------------------|
   * | < 1%  | Healthy                      |
   * | 1-5%  | Elevated (amber threshold)   |
   * | > 5%  | Critical (red threshold)     |
   */
  errorRate: number

  /** Number of currently open HTTP connections. */
  activeHttpConnections: number

  // -- Database pool ---------------------------------------------------------

  /** Database pool connections currently checked out. */
  dbPoolUsed: number

  /** Database pool connections sitting idle and available. */
  dbPoolFree: number

  /** Queries waiting for a pool connection to become available. */
  dbPoolPending: number

  /** Maximum pool size configured for the connection. */
  dbPoolMax: number

  // -- Redis -----------------------------------------------------------------

  /** `true` if Redis responded to PING successfully. */
  redisOk: boolean

  /** Redis server memory usage in **megabytes**. */
  redisMemoryUsedMb: number

  /** Number of clients currently connected to Redis. */
  redisConnectedClients: number

  /** Total number of keys across all Redis databases. */
  redisKeysCount: number

  /**
   * Redis cache hit rate as a **percentage** (0 -- 100).
   *
   * Calculated as `keyspace_hits / (keyspace_hits + keyspace_misses)`.
   *
   * | Range | Meaning                      |
   * |-------|------------------------------|
   * | > 90% | Healthy                      |
   * | 70-90%| Suboptimal (amber threshold) |
   * | < 70% | Poor (red threshold)         |
   */
  redisHitRate: number

  // -- Queue -----------------------------------------------------------------

  /** Number of jobs currently being processed. */
  queueActive: number

  /** Number of jobs waiting to be picked up by a worker. */
  queueWaiting: number

  /** Number of jobs scheduled for future execution. */
  queueDelayed: number

  /** Number of jobs that have permanently failed. */
  queueFailed: number

  /** Number of BullMQ worker processes connected to the queue. */
  queueWorkerCount: number

  // -- System ----------------------------------------------------------------

  /** OS load average over the last 1 minute. */
  systemLoadAvg1m: number

  /** OS load average over the last 5 minutes. */
  systemLoadAvg5m: number

  /** OS load average over the last 15 minutes. */
  systemLoadAvg15m: number

  /** Total system (OS) memory in **megabytes**. */
  systemMemoryTotalMb: number

  /** Free system (OS) memory in **megabytes**. */
  systemMemoryFreeMb: number

  /** System (OS) uptime in **seconds**. */
  systemUptime: number

  // -- Application -----------------------------------------------------------

  /** Number of active user sessions (from `sessions` table). */
  onlineUsers: number

  /** Number of webhook events with `"pending"` status. */
  pendingWebhooks: number

  /** Number of scheduled emails with `"pending"` status. */
  pendingEmails: number

  // -- Logs ------------------------------------------------------------------

  /** Number of `error` and `fatal` log entries in the last 5 minutes. */
  logErrorsLast5m: number

  /** Number of `warn` log entries in the last 5 minutes. */
  logWarningsLast5m: number

  /** Total log entries (all levels) in the last 5 minutes. */
  logEntriesLast5m: number

  /** Log entries per minute, averaged over the last 5 minutes. */
  logEntriesPerMinute: number
}

// ---------------------------------------------------------------------------
// Log stats (subset used by LogStreamService)
// ---------------------------------------------------------------------------

/**
 * Rolling log statistics computed by {@link LogStreamService}.
 *
 * Covers a 5-minute sliding window. Used internally by
 * `logCollector()` and exposed via `LogStreamService.getLogStats()`.
 */
export interface LogStats {
  /** Number of `error` (50) and `fatal` (60) entries in the window. */
  errorsLast5m: number

  /** Number of `warn` (40) entries in the window. */
  warningsLast5m: number

  /** Total entries (all levels) in the window. */
  entriesLast5m: number

  /** Entries per minute, averaged over the window. */
  entriesPerMinute: number
}

// ---------------------------------------------------------------------------
// Dev toolbar
// ---------------------------------------------------------------------------

/**
 * Configuration for the dev toolbar overlay.
 *
 * The dev toolbar adds a debug panel with SQL query inspection,
 * emitted event tracking, route table, and live logs. Only active
 * in non-production environments.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   devToolbar: {
 *     enabled: true,
 *     maxQueries: 500,
 *     slowQueryThresholdMs: 100,
 *     panes: [myCustomPane],
 *   },
 * })
 * ```
 */
export interface DevToolbarOptions {
  /** Enable the dev toolbar. Has no effect in production. */
  enabled: boolean

  /**
   * Maximum number of SQL queries to keep in the ring buffer.
   * @default 500
   */
  maxQueries?: number

  /**
   * Maximum number of emitted events to keep in the ring buffer.
   * @default 200
   */
  maxEvents?: number

  /**
   * Maximum number of captured emails to keep in the ring buffer.
   * @default 100
   */
  maxEmails?: number

  /**
   * Queries slower than this threshold (in **milliseconds**) are
   * highlighted in the toolbar.
   * @default 100
   */
  slowQueryThresholdMs?: number

  /**
   * Additional custom panes to display in the debug panel.
   *
   * Each pane fetches JSON from an endpoint you define and renders
   * a table based on column definitions.
   *
   * @see {@link DebugPane}
   */
  panes?: DebugPane[]

  /**
   * Persist debug data (queries, events, emails) to disk so it
   * survives server restarts.
   *
   * - `false` — no persistence
   * - `true` — persist to `.adonisjs/server-stats/debug-data.json`
   * - `string` — persist to the given path (relative to app root)
   *
   * @default false
   */
  persistDebugData?: boolean | string
}

// ---------------------------------------------------------------------------
// Main config
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for `adonisjs-server-stats`.
 *
 * Pass this to {@link defineConfig} in `config/server_stats.ts`.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'adonisjs-server-stats'
 * import { processCollector, httpCollector } from 'adonisjs-server-stats/collectors'
 *
 * export default defineConfig({
 *   intervalMs: 3000,
 *   transport: 'transmit',
 *   channelName: 'admin/server-stats',
 *   endpoint: '/admin/api/server-stats',
 *   collectors: [processCollector(), httpCollector()],
 * })
 * ```
 */
export interface ServerStatsConfig {
  /**
   * How often (in **milliseconds**) to run all collectors and
   * broadcast updated stats.
   *
   * Lower values give more responsive dashboards but increase
   * CPU and network overhead.
   *
   * @default 3000
   */
  intervalMs: number

  /**
   * How collected stats are pushed to connected clients.
   *
   * - `'transmit'` -- broadcast via AdonisJS Transmit (SSE).
   *   Requires `@adonisjs/transmit` as a peer dependency.
   * - `'none'` -- disable real-time push; clients must poll the
   *   HTTP endpoint.
   *
   * @default 'transmit'
   */
  transport: 'transmit' | 'none'

  /**
   * Transmit channel name used for SSE broadcasting.
   *
   * Clients subscribe to this channel to receive live updates.
   * Only relevant when `transport` is `'transmit'`.
   *
   * @default 'admin/server-stats'
   */
  channelName: string

  /**
   * HTTP endpoint path that returns the latest stats snapshot as JSON.
   *
   * Set to `false` to disable the built-in endpoint entirely
   * (e.g. if you provide your own controller).
   *
   * @default '/admin/api/server-stats'
   */
  endpoint: string | false

  /**
   * Array of collector instances that will be run each tick.
   *
   * Order does not matter -- all collectors run in parallel via
   * `Promise.all`. Each collector contributes a subset of fields
   * to the merged {@link ServerStats} snapshot.
   *
   * @example
   * ```ts
   * collectors: [
   *   processCollector(),
   *   systemCollector(),
   *   httpCollector({ maxRecords: 10_000 }),
   *   redisCollector(),
   * ]
   * ```
   */
  collectors: MetricCollector[]

  /**
   * Skip metric collection during test runs (`NODE_ENV=test`).
   *
   * Prevents collectors from interfering with test isolation
   * and speeds up the test suite.
   *
   * @default true
   */
  skipInTest?: boolean

  /**
   * Callback invoked after every collection tick with the merged
   * stats snapshot.
   *
   * Useful for custom logging, alerting, or forwarding metrics
   * to external systems.
   *
   * @example
   * ```ts
   * onStats: (stats) => {
   *   if (stats.cpuPercent && stats.cpuPercent > 90) {
   *     logger.warn('High CPU usage detected')
   *   }
   * }
   * ```
   */
  onStats?: (stats: Partial<ServerStats>) => void

  /**
   * Dev toolbar configuration.
   *
   * Adds a debug panel with SQL queries, emitted events, route
   * table, and live logs.
   *
   * @see {@link DevToolbarOptions}
   */
  devToolbar?: DevToolbarOptions

  /**
   * Per-request callback that decides whether the stats bar should
   * render for the current request.
   *
   * Receives the AdonisJS `HttpContext` and must return `true` to
   * show the bar. When not set, `@serverStats()` always renders.
   *
   * The callback is evaluated lazily at render time (after auth
   * middleware has run), so `ctx.auth.user` is available.
   *
   * @example
   * ```ts
   * // Only show for admin users
   * shouldShow: (ctx) => !!ctx.auth?.user?.isAdmin
   * ```
   *
   * @example
   * ```ts
   * // Only in development
   * shouldShow: () => process.env.NODE_ENV === 'development'
   * ```
   */
  shouldShow?: (ctx: any) => boolean
}

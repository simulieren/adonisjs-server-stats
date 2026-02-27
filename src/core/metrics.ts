// ---------------------------------------------------------------------------
// Metric definitions for the stats bar
// ---------------------------------------------------------------------------
//
// Ported from the BADGES array in src/edge/client/stats-bar.js.
// Each definition drives a single metric card in the stats bar,
// providing extraction, formatting, threshold coloring, and sparkline
// history tracking.
//
// The order of this array determines the display order in both
// the React and Vue stats bar components.
// ---------------------------------------------------------------------------

import type { MetricDefinition, ThresholdColor } from './types.js'
export type { MetricDefinition } from './types.js'
import {
  formatBytes,
  formatMb,
  formatCount,
  formatUptime,
  getThresholdColor,
  getThresholdColorInverse,
  getRatioColor,
  THRESHOLD_CSS_CLASS,
} from './formatters.js'

/** Map a threshold color to its CSS class. */
function colorClass(color: ThresholdColor): string {
  return THRESHOLD_CSS_CLASS[color] || ''
}

/**
 * All metric definitions in display order.
 *
 * Components iterate over this array to render each metric card.
 * Metrics with a `show` predicate are conditionally hidden when
 * the predicate returns `false` for the current stats snapshot.
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ── Process group ─────────────────────────────────────────────────────────

  // -- Node version ---------------------------------------------------------
  {
    id: 'node',
    label: 'NODE',
    title: 'Node.js Runtime',
    unit: '',
    group: 'process',
    extract: (s) => 0,
    format: (s) => s.nodeVersion,
    color: () => '',
  },

  // -- Uptime ---------------------------------------------------------------
  {
    id: 'uptime',
    label: 'UP',
    title: 'Process Uptime',
    unit: '',
    group: 'process',
    extract: (s) => s.uptime,
    format: (s) => formatUptime(s.uptime),
    color: () => '',
  },

  // -- CPU ------------------------------------------------------------------
  {
    id: 'cpu',
    label: 'CPU',
    title: 'CPU Usage',
    unit: '%',
    group: 'process',
    warnThreshold: 50,
    critThreshold: 80,
    extract: (s) => s.cpuPercent,
    format: (s) => `${s.cpuPercent.toFixed(1)}%`,
    color: (s) => colorClass(getThresholdColor(s.cpuPercent, 50, 80)),
    historyKey: 'cpuPercent',
  },

  // -- Event loop -----------------------------------------------------------
  {
    id: 'eventLoop',
    label: 'EVT',
    title: 'Event Loop Latency',
    unit: 'ms',
    group: 'process',
    warnThreshold: 20,
    critThreshold: 50,
    extract: (s) => s.eventLoopLag,
    format: (s) => `${s.eventLoopLag.toFixed(1)}ms`,
    color: (s) => colorClass(getThresholdColor(s.eventLoopLag, 20, 50)),
    historyKey: 'eventLoopLag',
  },

  // ── Memory group ──────────────────────────────────────────────────────────

  // -- Heap memory ----------------------------------------------------------
  {
    id: 'memory',
    label: 'HEAP',
    title: 'V8 Heap Usage',
    unit: 'bytes',
    group: 'memory',
    extract: (s) => s.memHeapUsed,
    format: (s) => formatBytes(s.memHeapUsed),
    color: () => '',
    historyKey: 'memHeapUsed',
  },

  // -- RSS ------------------------------------------------------------------
  {
    id: 'rss',
    label: 'RSS',
    title: 'Resident Set Size',
    unit: 'bytes',
    group: 'memory',
    extract: (s) => s.memRss,
    format: (s) => formatBytes(s.memRss),
    color: () => '',
    historyKey: 'memRss',
  },

  // -- System memory --------------------------------------------------------
  {
    id: 'systemMemory',
    label: 'SYS',
    title: 'System Memory',
    unit: 'MB',
    group: 'memory',
    extract: (s) => s.systemMemoryTotalMb - s.systemMemoryFreeMb,
    format: (s) =>
      `${formatMb(s.systemMemoryTotalMb - s.systemMemoryFreeMb)}/${formatMb(s.systemMemoryTotalMb)}`,
    color: (s) => {
      const total = s.systemMemoryTotalMb
      if (total === 0) return ''
      const used = total - s.systemMemoryFreeMb
      return colorClass(getRatioColor(used, total))
    },
    historyKey: '_sysMemUsed',
    show: (s) => s.systemMemoryTotalMb != null,
  },

  // ── HTTP group ────────────────────────────────────────────────────────────

  // -- Requests per second --------------------------------------------------
  {
    id: 'reqPerSec',
    label: 'REQ/s',
    title: 'Requests per Second',
    unit: '/s',
    group: 'http',
    extract: (s) => s.requestsPerSecond,
    format: (s) => s.requestsPerSecond.toFixed(1),
    color: () => '',
    historyKey: 'requestsPerSecond',
  },

  // -- Average response time ------------------------------------------------
  {
    id: 'avgResponse',
    label: 'AVG',
    title: 'Avg Response Time',
    unit: 'ms',
    group: 'http',
    warnThreshold: 200,
    critThreshold: 500,
    extract: (s) => s.avgResponseTimeMs,
    format: (s) => `${s.avgResponseTimeMs.toFixed(0)}ms`,
    color: (s) => colorClass(getThresholdColor(s.avgResponseTimeMs, 200, 500)),
    historyKey: 'avgResponseTimeMs',
  },

  // -- Error rate -----------------------------------------------------------
  {
    id: 'errorRate',
    label: 'ERR',
    title: 'Error Rate',
    unit: '%',
    group: 'http',
    warnThreshold: 1,
    critThreshold: 5,
    extract: (s) => s.errorRate,
    format: (s) => `${s.errorRate.toFixed(1)}%`,
    color: (s) => colorClass(getThresholdColor(s.errorRate, 1, 5)),
    historyKey: 'errorRate',
  },

  // -- Active connections ---------------------------------------------------
  {
    id: 'connections',
    label: 'CONN',
    title: 'Active Connections',
    unit: '',
    group: 'http',
    extract: (s) => s.activeHttpConnections,
    format: (s) => `${s.activeHttpConnections}`,
    color: () => '',
    historyKey: 'activeHttpConnections',
  },

  // ── DB group ──────────────────────────────────────────────────────────────

  // -- Database pool --------------------------------------------------------
  {
    id: 'dbPool',
    label: 'DB',
    title: 'Database Pool',
    unit: '',
    group: 'db',
    extract: (s) => s.dbPoolUsed,
    format: (s) => `${s.dbPoolUsed}/${s.dbPoolFree}/${s.dbPoolMax}`,
    color: (s) => colorClass(getRatioColor(s.dbPoolUsed, s.dbPoolMax)),
    historyKey: 'dbPoolUsed',
  },

  // ── Redis group ───────────────────────────────────────────────────────────

  // -- Redis status ---------------------------------------------------------
  {
    id: 'redis',
    label: 'REDIS',
    title: 'Redis Status',
    unit: '',
    group: 'redis',
    extract: (s) => (s.redisOk ? 1 : 0),
    format: (s) => (s.redisOk ? '\u2713' : '\u2717'),
    color: (s) => (s.redisOk ? 'ss-green' : 'ss-red'),
  },

  // -- Redis memory ---------------------------------------------------------
  {
    id: 'redisMem',
    label: 'MEM',
    title: 'Redis Memory',
    unit: 'MB',
    group: 'redis',
    extract: (s) => s.redisMemoryUsedMb,
    format: (s) => `${s.redisMemoryUsedMb.toFixed(1)}M`,
    color: () => '',
    historyKey: 'redisMemoryUsedMb',
    show: (s) => s.redisOk,
  },

  // -- Redis keys -----------------------------------------------------------
  {
    id: 'redisKeys',
    label: 'KEYS',
    title: 'Redis Keys',
    unit: '',
    group: 'redis',
    extract: (s) => s.redisKeysCount,
    format: (s) => formatCount(s.redisKeysCount),
    color: () => '',
    historyKey: 'redisKeysCount',
    show: (s) => s.redisOk,
  },

  // -- Redis hit rate -------------------------------------------------------
  {
    id: 'redisHitRate',
    label: 'HIT',
    title: 'Redis Hit Rate',
    unit: '%',
    group: 'redis',
    warnThreshold: 90,
    critThreshold: 70,
    inverseThreshold: true,
    extract: (s) => s.redisHitRate,
    format: (s) => `${s.redisHitRate.toFixed(0)}%`,
    color: (s) => colorClass(getThresholdColorInverse(s.redisHitRate, 90, 70)),
    historyKey: 'redisHitRate',
    show: (s) => s.redisOk,
  },

  // ── Queue group ───────────────────────────────────────────────────────────

  // -- Queue ----------------------------------------------------------------
  {
    id: 'queue',
    label: 'Q',
    title: 'Job Queue',
    unit: '',
    group: 'queue',
    extract: (s) => s.queueActive,
    format: (s) => `${s.queueActive}/${s.queueWaiting}/${s.queueDelayed}`,
    color: (s) => (s.queueFailed > 0 ? 'ss-amber' : 'ss-green'),
    historyKey: 'queueActive',
  },

  // -- Queue workers --------------------------------------------------------
  {
    id: 'queueWorkers',
    label: 'WORKERS',
    title: 'Queue Workers',
    unit: '',
    group: 'queue',
    extract: (s) => s.queueWorkerCount,
    format: (s) => `${s.queueWorkerCount}`,
    color: () => '',
  },

  // ── App group ─────────────────────────────────────────────────────────────

  // -- Online users ---------------------------------------------------------
  {
    id: 'onlineUsers',
    label: 'USERS',
    title: 'Online Users',
    unit: '',
    group: 'app',
    extract: (s) => s.onlineUsers,
    format: (s) => `${s.onlineUsers}`,
    color: () => '',
    historyKey: 'onlineUsers',
  },

  // -- Pending webhooks -----------------------------------------------------
  {
    id: 'pendingWebhooks',
    label: 'HOOKS',
    title: 'Pending Webhooks',
    unit: '',
    group: 'app',
    extract: (s) => s.pendingWebhooks,
    format: (s) => `${s.pendingWebhooks}`,
    color: (s) => (s.pendingWebhooks > 0 ? 'ss-amber' : ''),
    historyKey: 'pendingWebhooks',
  },

  // -- Pending emails -------------------------------------------------------
  {
    id: 'pendingEmails',
    label: 'MAIL',
    title: 'Pending Emails',
    unit: '',
    group: 'app',
    extract: (s) => s.pendingEmails,
    format: (s) => `${s.pendingEmails}`,
    color: (s) => (s.pendingEmails > 0 ? 'ss-amber' : ''),
    historyKey: 'pendingEmails',
  },

  // ── Logs group ────────────────────────────────────────────────────────────

  // -- Logs (errors) --------------------------------------------------------
  {
    id: 'logErrors',
    label: 'LOG ERR',
    title: 'Log Errors (5m)',
    unit: '',
    group: 'log',
    extract: (s) => s.logErrorsLast5m,
    format: (s) => `${s.logErrorsLast5m}`,
    color: (s) => (s.logErrorsLast5m > 0 ? 'ss-red' : s.logWarningsLast5m > 0 ? 'ss-amber' : ''),
    historyKey: 'logErrorsLast5m',
  },

  // -- Log rate -------------------------------------------------------------
  {
    id: 'logRate',
    label: 'LOG/m',
    title: 'Log Entries / Minute',
    unit: '/m',
    group: 'log',
    extract: (s) => s.logEntriesPerMinute,
    format: (s) => `${s.logEntriesPerMinute}`,
    color: () => '',
    historyKey: 'logEntriesPerMinute',
  },
]

/**
 * Look up a metric definition by its ID.
 *
 * @param id - Metric identifier (e.g. `'cpu'`, `'memory'`).
 * @returns The matching definition, or `undefined` if not found.
 */
export function getMetricById(id: string): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.id === id)
}

/**
 * Group metric definitions by their `group` field.
 *
 * Returns a `Map` where keys are group names and values are
 * arrays of metrics in that group. Metrics without an explicit
 * `group` default to `'core'`.
 *
 * The map iteration order matches first-seen order of groups
 * in {@link METRIC_DEFINITIONS}.
 *
 * @returns A map of group name to metric definitions.
 */
export function getMetricsByGroup(): Map<string, MetricDefinition[]> {
  const groups = new Map<string, MetricDefinition[]>()
  for (const metric of METRIC_DEFINITIONS) {
    const group = metric.group || 'core'
    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group)!.push(metric)
  }
  return groups
}

/**
 * Maximum number of data points to keep in the sparkline history
 * buffer per metric. Matches the Edge implementation.
 */
export const MAX_HISTORY = 60

/**
 * Milliseconds after the last successful update before the connection
 * is considered stale (amber dot indicator).
 */
export const STALE_MS = 10_000

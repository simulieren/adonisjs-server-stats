// ---------------------------------------------------------------------------
// Re-exports from the main package
// ---------------------------------------------------------------------------

export type { ServerStats, MetricValue, ServerStatsConfig, DevToolbarOptions } from '../types.js'
export type {
  DebugPane,
  DebugPaneColumn,
  DebugPaneSearch,
  DebugPaneFormatType,
  BadgeColor,
  QueryRecord,
  EventRecord,
  EmailRecord,
  RouteRecord,
  TraceRecord,
  TraceSpan,
} from '../debug/types.js'

// ---------------------------------------------------------------------------
// Component prop types
// ---------------------------------------------------------------------------

/**
 * Props / config for the `<ServerStatsBar />` component.
 */
export interface StatsBarProps {
  /** Base URL for API calls. Defaults to `''` (same origin). */
  baseUrl?: string
  /** Stats endpoint path. Defaults to `'/admin/api/server-stats'`. */
  endpoint?: string
  /** Transmit channel name. Defaults to `'admin/server-stats'`. */
  channelName?: string
  /** Optional auth token for Bearer auth (auto-detects cookies if omitted). */
  authToken?: string
  /** Polling interval fallback in ms. Defaults to `3000`. */
  pollInterval?: number
  /** CSS class overrides for the root element. */
  className?: string
}

/**
 * Props for the `<DebugPanel />` component.
 */
export interface DebugPanelProps {
  /** Base URL for API calls. Defaults to `''` (same origin). */
  baseUrl?: string
  /** Debug API base path. Defaults to `'/admin/api/debug'`. */
  debugEndpoint?: string
  /** Optional auth token for Bearer auth. */
  authToken?: string
  /** CSS class overrides for panel container. */
  className?: string
}

/**
 * Props for the `<DashboardPage />` component.
 */
export interface DashboardPageProps {
  /** Base URL for API calls. Defaults to `''` (same origin). */
  baseUrl?: string
  /** Dashboard API base path. Defaults to `'/__stats/api'`. */
  dashboardEndpoint?: string
  /** Optional auth token for Bearer auth. */
  authToken?: string
  /** Transmit channel name for live updates. Defaults to `'server-stats/dashboard'`. */
  channelName?: string
  /** CSS class overrides for the root element. */
  className?: string
}

/**
 * Alias for {@link StatsBarProps}. Used by Vue components as config type.
 */
export interface StatsBarConfig extends StatsBarProps {
  /** Debug API endpoint path (used for feature detection). */
  debugEndpoint?: string
}

/**
 * Alias for {@link DebugPanelProps}. Used by Vue components as config type.
 */
export interface DebugPanelConfig extends DebugPanelProps {
  /** Path to the full dashboard page. */
  dashboardPath?: string
  /** Whether tracing is enabled. */
  tracingEnabled?: boolean
  /** Whether the stats bar is connected via Transmit (SSE) for live updates. */
  isLive?: boolean
}

/**
 * Alias for {@link DashboardPageProps}. Used by Vue components as config type.
 */
export interface DashboardConfig extends DashboardPageProps {
  /** Whether tracing is enabled. */
  tracingEnabled?: boolean
}

// ---------------------------------------------------------------------------
// Feature flags (config endpoint response)
// ---------------------------------------------------------------------------

/**
 * Shape returned by `GET {debugEndpoint}/config`.
 *
 * Tells the UI which sections to render and where to find endpoints.
 */
export interface FeatureFlags {
  features: {
    statsBar: boolean
    debugPanel: boolean
    dashboard: boolean
    tracing: boolean
    process: boolean
    system: boolean
    http: boolean
    db: boolean
    redis: boolean
    queues: boolean
    cache: boolean
    app: boolean
    log: boolean
    emails: boolean
  }
  customPanes: import('../debug/types.js').DebugPane[]
  endpoints: {
    stats: string
    debug: string
    dashboard: string
  }
  transmit: {
    channelName: string
  }
}

/**
 * Flattened feature config used by Vue composables.
 *
 * Provides a flat interface for feature flags plus custom panes,
 * simplifying access in Vue components (e.g. `features.tracing`
 * instead of `features.features.tracing`).
 */
export interface FeatureConfig {
  tracing: boolean
  process: boolean
  system: boolean
  http: boolean
  db: boolean
  redis: boolean
  queues: boolean
  cache: boolean
  app: boolean
  log: boolean
  emails: boolean
  dashboard: boolean
  customPanes: import('../debug/types.js').DebugPane[]
}

// ---------------------------------------------------------------------------
// Metric definition (drives the stats bar layout)
// ---------------------------------------------------------------------------

import type { ServerStats } from '../types.js'

/**
 * Threshold color result.
 */
export type ThresholdColor = 'green' | 'amber' | 'red'

/**
 * Definition for a single metric displayed in the stats bar.
 *
 * Each definition drives rendering in both React and Vue:
 * label for display, extract for reading the value from a snapshot,
 * format for string output, and threshold config for color coding.
 */
export interface MetricDefinition {
  /** Unique metric identifier (e.g. `'cpu'`, `'memory'`). */
  id: string

  /** Short display label (e.g. `'CPU'`, `'MEM'`). */
  label: string

  /**
   * Longer display title for tooltips (e.g. `'CPU Usage'`, `'Memory'`).
   * Falls back to `label` if not provided.
   */
  title?: string

  /**
   * Unit string for display and tooltip (e.g. `'%'`, `'ms'`, `'bytes'`).
   * Empty string for unitless metrics.
   */
  unit: string

  /**
   * Metric group for layout grouping in the stats bar.
   * Standard groups: `'core'`, `'db'`, `'redis'`, `'queue'`, `'log'`.
   * Defaults to `'core'` if not specified.
   */
  group?: string

  /**
   * Value at or above which the metric turns amber.
   * For inverse metrics (higher is better), this is the *below* threshold.
   * `undefined` means no threshold coloring.
   */
  warnThreshold?: number

  /**
   * Value at or above which the metric turns red.
   * For inverse metrics (higher is better), this is the *below* threshold.
   * `undefined` means no threshold coloring.
   */
  critThreshold?: number

  /**
   * Whether the threshold logic is inverted (lower values are worse).
   * Used for metrics like cache hit rate where <90% is amber and <70% is red.
   */
  inverseThreshold?: boolean

  /**
   * Extract the numeric value from a stats snapshot.
   * Returns `undefined` if the metric is not available in this snapshot.
   */
  extract: (stats: ServerStats) => number | undefined

  /**
   * Format the extracted value for display (e.g. `"52.3%"`, `"128M"`).
   * Alias: `value` (same function, alternate name for React).
   */
  format: (stats: ServerStats) => string

  /**
   * Alias for {@link format}. Returns the formatted display string.
   */
  value?: (stats: ServerStats) => string

  /**
   * Return a CSS class name for threshold coloring (e.g. `'ss-green'`).
   * Used by React components. When not provided, the component should
   * compute the color from `warnThreshold`/`critThreshold`.
   */
  color?: (stats: ServerStats) => string

  /**
   * Additional detail text (or a function returning detail text)
   * shown in the tooltip below the main value.
   */
  detail?: string | ((stats: ServerStats) => string | null)

  /**
   * Key on `ServerStats` to track in the sparkline history buffer.
   * `undefined` means no sparkline for this metric.
   * A leading `_` prefix indicates a computed value (e.g. `'_sysMemUsed'`).
   */
  historyKey?: string | undefined

  /**
   * Optional predicate to conditionally show/hide this metric
   * based on the current stats snapshot.
   */
  show?: (stats: ServerStats) => boolean
}

// ---------------------------------------------------------------------------
// Sparkline options
// ---------------------------------------------------------------------------

/**
 * Options for SVG sparkline rendering.
 */
export interface SparklineOptions {
  /** Stroke color (CSS color string). Defaults to `'#34d399'`. */
  color?: string
  /** Fill gradient top opacity (0-1). Defaults to `0.25`. */
  fillOpacityTop?: number
  /** Fill gradient bottom opacity (0-1). Defaults to `0.02`. */
  fillOpacityBottom?: number
  /** Line stroke width. Defaults to `1.5`. */
  strokeWidth?: number
  /** SVG viewBox width. Defaults to `120`. */
  width?: number
  /** SVG viewBox height. Defaults to `32`. */
  height?: number
  /** Inner padding in px. Defaults to `2`. */
  padding?: number
}

// ---------------------------------------------------------------------------
// Hook option aliases (used by React / Vue hooks)
// ---------------------------------------------------------------------------

/**
 * Options for the `useDashboardData` hook.
 * Extends {@link DashboardPageProps} with pagination, sort, filter, and time range options.
 */
export interface DashboardHookOptions extends DashboardPageProps {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  filters?: Record<string, string>
  timeRange?: TimeRange
  /** Incrementing key to trigger a refetch (used by live mode). */
  refreshKey?: number
}

// ---------------------------------------------------------------------------
// Section / tab identifiers
// ---------------------------------------------------------------------------

/**
 * Built-in debug panel tab identifiers.
 *
 * Known tabs are provided for autocomplete; any custom string is also accepted.
 */
export type DebugTab =
  | 'timeline'
  | 'queries'
  | 'events'
  | 'routes'
  | 'logs'
  | 'emails'
  | 'cache'
  | 'jobs'
  | (string & {})

/**
 * Built-in dashboard section identifiers.
 *
 * Known sections are provided for autocomplete; any custom string is also accepted.
 */
export type DashboardSection =
  | 'overview'
  | 'requests'
  | 'queries'
  | 'events'
  | 'routes'
  | 'logs'
  | 'emails'
  | 'timeline'
  | 'cache'
  | 'jobs'
  | 'config'
  | (string & {})

// ---------------------------------------------------------------------------
// Time range
// ---------------------------------------------------------------------------

/**
 * Pre-defined time range options for dashboard queries.
 */
export type TimeRange = '5m' | '15m' | '30m' | '1h' | '6h' | '24h' | '7d'

// ---------------------------------------------------------------------------
// Paginated response envelope
// ---------------------------------------------------------------------------

/**
 * Generic paginated API response shape.
 */
export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    lastPage: number
  }
}

// ---------------------------------------------------------------------------
// Cache types (debug panel)
// ---------------------------------------------------------------------------

/**
 * Aggregate cache statistics returned by the debug cache endpoint.
 */
export interface CacheStats {
  hitRate: number
  totalHits: number
  totalMisses: number
  keys: CacheEntry[]
}

/**
 * Individual cache key metadata.
 */
export interface CacheEntry {
  key: string
  type: string
  ttl: number
  size: number
}

// ---------------------------------------------------------------------------
// Job / queue types (debug panel)
// ---------------------------------------------------------------------------

/**
 * Aggregate queue statistics.
 */
export interface JobStats {
  active: number
  waiting: number
  delayed: number
  completed: number
  failed: number
}

/**
 * Individual job record from the queue inspector.
 */
export interface JobRecord {
  id: string
  name: string
  status: string
  data: unknown
  payload: unknown
  attempts: number
  duration: number | null
  timestamp: number | string
  createdAt: number | string
  processedAt: number | string | null
  finishedAt: number | string | null
  failedReason: string | null
}

// ---------------------------------------------------------------------------
// Dashboard overview types
// ---------------------------------------------------------------------------

/**
 * Aggregated overview metrics returned by the dashboard overview endpoint.
 */
export interface OverviewMetrics {
  avgResponseTime: number
  p95ResponseTime: number
  requestsPerMinute: number
  errorRate: number
  totalRequests: number
  slowestEndpoints: { url?: string; pattern?: string; avgDuration: number; count: number }[]
  queryStats: { total: number; avgDuration: number; perRequest: number }
  recentErrors: { id?: number; level: string; message: string; timestamp?: number | string }[]
  topEvents: { eventName?: string; name?: string; event_name?: string; event?: string; count: number }[]
  emailActivity: { sent: number; queued: number; failed: number }
  logLevelBreakdown: { error: number; warn: number; info: number; debug: number }
  cacheStats: { available: boolean; totalKeys: number; hitRate: number; memoryUsedHuman: string } | null
  jobQueueStatus: { available: boolean; active: number; waiting: number; failed: number; completed: number } | null
  statusDistribution: { '2xx': number; '3xx': number; '4xx': number; '5xx': number }
  slowestQueries: { sqlNormalized?: string; normalizedSql?: string; sql_normalized?: string; sql?: string; avgDuration: number; count: number }[]
  sparklines?: {
    avgResponseTime?: number[]
    p95ResponseTime?: number[]
    requestsPerMinute?: number[]
    errorRate?: number[]
  }
}

/**
 * Extended overview data used by Vue dashboard components.
 * Extends {@link OverviewMetrics} with sparkline time-series data.
 */
export interface OverviewData extends OverviewMetrics {
  avgResponseTimeSeries?: number[]
  p95ResponseTimeSeries?: number[]
  requestsPerMinuteSeries?: number[]
  errorRateSeries?: number[]
  recentErrors: {
    id?: number
    level: string
    message: string
    timestamp: number | string
  }[]
}

/**
 * Single data point for dashboard time-series charts.
 */
export interface ChartDataPoint {
  bucket: string
  total: number
  count2xx: number
  count3xx: number
  count4xx: number
  count5xx: number
  requestCount?: number
  errorCount?: number
  avgDuration?: number
  p95Duration?: number
}

/**
 * A grouped/aggregated query pattern for the dashboard queries section.
 */
export interface GroupedQuery {
  pattern: string
  count: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  totalDuration: number
  percentOfTotal: number
}

// ---------------------------------------------------------------------------
// Theme type (re-exported for convenience)
// ---------------------------------------------------------------------------

export type { Theme } from './theme.js'

// ---------------------------------------------------------------------------
// Pagination / filter / sort state
// ---------------------------------------------------------------------------

/**
 * Pagination state for table components.
 */
export interface PaginationState {
  /** Current page number (1-based). */
  page: number
  /** Number of items per page. */
  perPage: number
  /** Total number of items across all pages. */
  total: number
  /** Total number of pages. */
  totalPages: number
}

/**
 * Filter state for table components.
 */
export interface FilterState {
  /** Free-text search query. */
  search: string
  /** Key-value filter pairs (e.g. `{ status: '500', method: 'GET' }`). */
  filters: Record<string, string>
}

/**
 * Sort state for table components.
 */
export interface SortState {
  /** Column field name to sort by. */
  field: string
  /** Sort direction. */
  direction: 'asc' | 'desc'
}

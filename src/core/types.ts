// ---------------------------------------------------------------------------
// Re-exports from the main package
// ---------------------------------------------------------------------------

export type {
  ServerStats,
  MetricValue,
  ServerStatsConfig,
  ResolvedServerStatsConfig,
  DevToolbarOptions,
  ToolbarConfig,
  AdvancedConfig,
} from '../types.js'
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
// Re-exports from split type files
// ---------------------------------------------------------------------------

export type {
  OverviewMetrics,
  OverviewData,
  ChartDataPoint,
  GroupedQuery,
  DashboardCacheStats,
  DashboardCacheKeyEntry,
  DashboardCacheResponse,
  JobsApiResponse,
  JobStats,
  JobRecord,
} from './types-dashboard.js'

export type {
  DiagnosticsBufferInfo,
  DiagnosticsCollectorInfo,
  DiagnosticsTimerInfo,
  DiagnosticsResponse,
} from './types-diagnostics.js'

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

/** Props for the `<DebugPanel />` component. */
export interface DebugPanelProps {
  baseUrl?: string
  debugEndpoint?: string
  authToken?: string
  className?: string
}

/** Props for the `<DashboardPage />` component. */
export interface DashboardPageProps {
  baseUrl?: string
  dashboardEndpoint?: string
  authToken?: string
  channelName?: string
  className?: string
}

/** Alias for {@link StatsBarProps}. Used by Vue components as config type. */
export interface StatsBarConfig extends StatsBarProps {
  debugEndpoint?: string
}

/** Alias for {@link DebugPanelProps}. Used by Vue components as config type. */
export interface DebugPanelConfig extends DebugPanelProps {
  dashboardPath?: string
  tracingEnabled?: boolean
  isLive?: boolean
}

/** Alias for {@link DashboardPageProps}. Used by Vue components as config type. */
export interface DashboardConfig extends DashboardPageProps {
  tracingEnabled?: boolean
}

// ---------------------------------------------------------------------------
// Feature flags (config endpoint response)
// ---------------------------------------------------------------------------

/**
 * Shape returned by `GET {debugEndpoint}/config`.
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
  endpoints: { stats: string; debug: string; dashboard: string }
  transmit: { channelName: string }
}

/**
 * Flattened feature config used by Vue composables.
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

/** Threshold color result. */
export type ThresholdColor = 'green' | 'amber' | 'red'

/**
 * Definition for a single metric displayed in the stats bar.
 */
export interface MetricDefinition {
  id: string
  label: string
  title?: string
  unit: string
  group?: string
  warnThreshold?: number
  critThreshold?: number
  inverseThreshold?: boolean
  extract: (stats: ServerStats) => number | undefined
  format: (stats: ServerStats) => string
  value?: (stats: ServerStats) => string
  color?: (stats: ServerStats) => string
  detail?: string | ((stats: ServerStats) => string | null)
  historyKey?: string | undefined
  show?: (stats: ServerStats) => boolean
}

// ---------------------------------------------------------------------------
// Sparkline options
// ---------------------------------------------------------------------------

/** Options for SVG sparkline rendering. */
export interface SparklineOptions {
  color?: string
  fillOpacityTop?: number
  fillOpacityBottom?: number
  strokeWidth?: number
  width?: number
  height?: number
  padding?: number
}

// ---------------------------------------------------------------------------
// Hook option aliases (used by React / Vue hooks)
// ---------------------------------------------------------------------------

/**
 * Options for the `useDashboardData` hook.
 */
export interface DashboardHookOptions extends DashboardPageProps {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  filters?: Record<string, string>
  timeRange?: TimeRange
  refreshKey?: number
}

// ---------------------------------------------------------------------------
// Section / tab identifiers
// ---------------------------------------------------------------------------

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

export type DashboardSection =
  | 'overview'
  | 'requests'
  | 'queries'
  | 'events'
  | 'routes'
  | 'logs'
  | 'emails'
  | 'cache'
  | 'jobs'
  | 'config'
  | (string & {})

export type TimeRange = '5m' | '15m' | '30m' | '1h' | '6h' | '24h' | '7d'

// ---------------------------------------------------------------------------
// Paginated response envelope
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; lastPage: number }
}

// ---------------------------------------------------------------------------
// Cache types (debug panel)
// ---------------------------------------------------------------------------

export interface CacheStats {
  hitRate: number
  totalHits: number
  totalMisses: number
  keys: CacheEntry[]
  keyCount?: number
  memoryUsedMb?: number
}

export interface CacheEntry {
  key: string
  type: string
  ttl: number
  size: number
  value?: string | number | boolean | Record<string, unknown> | unknown[] | null
}

// ---------------------------------------------------------------------------
// Pagination / filter / sort state
// ---------------------------------------------------------------------------

export interface PaginationState {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface FilterState {
  search: string
  filters: Record<string, string>
}

export interface SortState {
  field: string
  direction: 'asc' | 'desc'
}

// ---------------------------------------------------------------------------
// Theme type (re-exported for convenience)
// ---------------------------------------------------------------------------

export type { Theme } from './theme.js'

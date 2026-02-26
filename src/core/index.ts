// ---------------------------------------------------------------------------
// Public barrel export for the shared core layer
// ---------------------------------------------------------------------------

// -- API client -------------------------------------------------------------
export { ApiClient, UnauthorizedError, ApiError } from './api-client.js'
export type { ApiClientConfig } from './api-client.js'

// -- Transmit adapter -------------------------------------------------------
export { createTransmitSubscription, subscribeToChannel } from './transmit-adapter.js'
export type { TransmitSubscriptionConfig, TransmitSubscriptionHandle, ChannelSubscriptionConfig } from './transmit-adapter.js'

// -- Types ------------------------------------------------------------------
export type {
  // Re-exported from main package
  ServerStats,
  MetricValue,
  ServerStatsConfig,
  DevToolbarOptions,
  // Re-exported from debug types
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
  // Component props
  StatsBarProps,
  DebugPanelProps,
  DashboardPageProps,
  // Config aliases (used by Vue components)
  StatsBarConfig,
  DebugPanelConfig,
  DashboardConfig,
  FeatureConfig,
  // Hook option types
  DashboardHookOptions,
  // Section / tab identifiers
  DebugTab,
  DashboardSection,
  // Time range
  TimeRange,
  // Paginated response
  PaginatedResponse,
  // Cache types
  CacheStats,
  CacheEntry,
  // Job / queue types
  JobStats,
  JobRecord,
  // Dashboard overview types
  OverviewMetrics,
  OverviewData,
  ChartDataPoint,
  GroupedQuery,
  // Theme
  Theme,
  // Feature flags
  FeatureFlags,
  // Metric definitions
  MetricDefinition,
  ThresholdColor,
  // Sparkline
  SparklineOptions,
  // Pagination / filter / sort
  PaginationState,
  FilterState,
  SortState,
} from './types.js'

// -- Theme ------------------------------------------------------------------
export { getTheme, setTheme, toggleTheme, onThemeChange } from './theme.js'

// -- Sparkline --------------------------------------------------------------
export {
  generateSparklinePoints,
  generateSparklinePath,
  generateGradientId,
  computeStats,
  buildSparklineData,
} from './sparkline.js'
export type { SparklineStats, SparklineData } from './sparkline.js'

// -- Formatters -------------------------------------------------------------
export {
  formatUptime,
  formatBytes,
  formatMb,
  formatCount,
  formatDuration,
  formatTime,
  timeAgo,
  formatStatNum,
  getThresholdColor,
  getThresholdColorInverse,
  getRatioColor,
  compactPreview,
  statusColor,
  durationSeverity,
  shortReqId,
  THRESHOLD_CSS_CLASS,
  THRESHOLD_HEX_FALLBACK,
  THRESHOLD_CSS_VAR,
} from './formatters.js'

// -- Pagination -------------------------------------------------------------
export {
  DEFAULT_PER_PAGE,
  buildQueryString,
  buildQueryParams,
  computePagination,
  parsePaginatedResponse,
  createPaginationState,
  createFilterState,
  createSortState,
  getPageNumbers,
} from './pagination.js'
export type { RawPaginatedResponse } from './pagination.js'

// -- Feature detection ------------------------------------------------------
export { fetchFeatures, detectFeatures, DEFAULT_FEATURES, getVisibleMetricGroups } from './feature-detect.js'

// -- Metrics ----------------------------------------------------------------
export { METRIC_DEFINITIONS, getMetricById, getMetricsByGroup, MAX_HISTORY, STALE_MS } from './metrics.js'

// -- Routes / tab-to-path mappings ------------------------------------------
export { getDebugTabPath, getDashboardSectionPath, DEBUG_TAB_PATHS, DASHBOARD_SECTION_PATHS } from './routes.js'

// -- History buffer ---------------------------------------------------------
export { createHistoryBuffer } from './history-buffer.js'
export type { HistoryBuffer } from './history-buffer.js'

// -- Dashboard API ----------------------------------------------------------
export { DashboardApi } from './dashboard-api.js'

// -- Constants --------------------------------------------------------------
export { OVERVIEW_REFRESH_MS, SECTION_REFRESH_MS, DEBUG_REFRESH_MS } from './constants.js'

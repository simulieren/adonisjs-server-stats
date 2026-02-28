// ---------------------------------------------------------------------------
// Public barrel export for the shared core layer
// ---------------------------------------------------------------------------

// -- API client -------------------------------------------------------------
export { ApiClient, UnauthorizedError, ApiError } from './api-client.js'
export type { ApiClientConfig } from './api-client.js'

// -- Transmit adapter -------------------------------------------------------
export { createTransmitSubscription, subscribeToChannel } from './transmit-adapter.js'
export type {
  TransmitSubscriptionConfig,
  TransmitSubscriptionHandle,
  ChannelSubscriptionConfig,
} from './transmit-adapter.js'

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
  JobsApiResponse,
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
  // Diagnostics types
  DiagnosticsResponse,
  DiagnosticsBufferInfo,
  DiagnosticsCollectorInfo,
  DiagnosticsTimerInfo,
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
  formatTtl,
  formatCacheSize,
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
export {
  fetchFeatures,
  detectFeatures,
  DEFAULT_FEATURES,
  getVisibleMetricGroups,
  detectMetricGroupsFromStats,
} from './feature-detect.js'

// -- Metrics ----------------------------------------------------------------
export {
  METRIC_DEFINITIONS,
  getMetricById,
  getMetricsByGroup,
  MAX_HISTORY,
  STALE_MS,
} from './metrics.js'

// -- Routes / tab-to-path mappings ------------------------------------------
export {
  getDebugTabPath,
  getDashboardSectionPath,
  DEBUG_TAB_PATHS,
  DASHBOARD_SECTION_PATHS,
} from './routes.js'

// -- History buffer ---------------------------------------------------------
export { createHistoryBuffer } from './history-buffer.js'
export type { HistoryBuffer } from './history-buffer.js'

// -- Server stats controller ------------------------------------------------
export { ServerStatsController } from './server-stats-controller.js'
export type { ServerStatsControllerConfig, ConnectionMode } from './server-stats-controller.js'

// -- Dashboard API ----------------------------------------------------------
export { DashboardApi } from './dashboard-api.js'

// -- Dashboard data controller ----------------------------------------------
export { DashboardDataController } from './dashboard-data-controller.js'
export type {
  DashboardDataControllerConfig,
  DashboardDataCallbacks,
} from './dashboard-data-controller.js'

// -- Constants --------------------------------------------------------------
export {
  OVERVIEW_REFRESH_MS,
  SECTION_REFRESH_MS,
  DEBUG_REFRESH_MS,
  SLOW_DURATION_MS,
  VERY_SLOW_DURATION_MS,
} from './constants.js'

// -- Icons ------------------------------------------------------------------
export { TAB_ICONS } from './icons.js'
export type { TabIconDef } from './icons.js'

// -- Resizable columns ------------------------------------------------------
export { initResizableColumns } from './resizable-columns.js'

// -- Debug data controller --------------------------------------------------
export { DebugDataController } from './debug-data-controller.js'
export type { DebugDataControllerConfig, DebugDataControllerCallbacks } from './debug-data-controller.js'

// -- Log utilities ----------------------------------------------------------
export {
  LOG_LEVELS,
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  filterLogsByLevel,
} from './log-utils.js'
export type { LogEntry } from './log-utils.js'

// -- Query utilities --------------------------------------------------------
export { filterQueries, countDuplicateQueries, computeQuerySummary } from './query-utils.js'
export type { QuerySummary } from './query-utils.js'

// -- Job utilities ----------------------------------------------------------
export {
  JOB_STATUS_FILTERS,
  getJobStatusCssClass,
  getJobStatusBadgeColor,
  extractJobs,
  extractJobStats,
} from './job-utils.js'
export type { JobStatusFilter } from './job-utils.js'

// -- Trace utilities --------------------------------------------------------
export {
  parseTraceSpans,
  parseTraceWarnings,
  resolveTraceField,
  normalizeTraceFields,
} from './trace-utils.js'
export type { TraceDetail, NormalizedTrace } from './trace-utils.js'

// -- Internals / diagnostics utilities --------------------------------------
export {
  isSecretKey,
  formatConfigVal,
  TIMER_LABELS,
  getTimerLabel,
  INTEGRATION_LABELS,
  getIntegrationLabel,
  getIntegrationStatus,
  getIntegrationDetails,
  formatCollectorConfig,
  fillPercent,
  OK_STATUSES,
  ERROR_STATUSES,
  classifyStatus,
} from './internals-utils.js'

// -- Config utilities -------------------------------------------------------
export {
  isRedactedValue,
  flattenConfig,
  formatFlatValue,
  countLeaves,
  collectTopLevelObjectKeys,
  matchesConfigSearch,
  copyWithFeedback,
  REDACT_PATTERN,
} from './config-utils.js'
export type {
  RedactedValue,
  ConfigValue,
  FlatEntry,
  FormattedValue,
} from './config-utils.js'

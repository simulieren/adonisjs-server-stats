// ---------------------------------------------------------------------------
// Shared config interfaces for Edge entry points (Preact & Vue)
// ---------------------------------------------------------------------------

/**
 * Config passed to the stats bar entry via `#ss-bar-config` script tag.
 */
export interface EdgeBarConfig {
  endpoint?: string
  pollInterval?: number
  channelName?: string
  authToken?: string
  showDebug?: boolean
  debugEndpoint?: string
  dashboardPath?: string | null
}

/**
 * Config passed to the debug panel entry via `#ss-dbg-config` script tag.
 */
export interface EdgeDebugConfig {
  debugEndpoint?: string
  authToken?: string
  dashboardPath?: string | null
}

/**
 * Config passed to the dashboard entry via `#ss-dash-config` script tag.
 */
export interface EdgeDashConfig {
  baseUrl?: string
  dashboardEndpoint?: string
  debugEndpoint?: string
  authToken?: string
  backUrl?: string
  channelName?: string
}

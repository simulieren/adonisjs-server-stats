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

// ---------------------------------------------------------------------------
// Deferred debug panel global interface
// ---------------------------------------------------------------------------

/**
 * The deferred debug panel entry registers itself onto `window.__ssDebugPanel`.
 * The slim stats-bar entry evaluates the inert `<script type="text/plain">`
 * on first use and then calls these helpers to mount/unmount the panel.
 */
export interface DeferredDebugPanel {
  mount(container: HTMLElement, config: EdgeDebugConfig, isLive: boolean): void
  unmount(container: HTMLElement): void
}

declare global {
  interface Window {
    __ssDebugPanel?: DeferredDebugPanel
  }
}

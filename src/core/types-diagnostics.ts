// ---------------------------------------------------------------------------
// Diagnostics types (used by InternalsContent / InternalsTab)
// ---------------------------------------------------------------------------

/** Buffer usage info returned by the diagnostics endpoint. */
export interface DiagnosticsBufferInfo {
  current: number
  max: number
}

/** Collector metadata returned by the diagnostics endpoint. */
export interface DiagnosticsCollectorInfo {
  name: string
  label: string
  status: 'healthy' | 'errored' | 'stopped'
  lastError: string | null
  lastErrorAt: number | null
  config: Record<string, unknown>
}

/** Timer state returned by the diagnostics endpoint. */
export interface DiagnosticsTimerInfo {
  active: boolean
  intervalMs?: number
  debounceMs?: number
}

/**
 * Full diagnostics response from `GET {debugEndpoint}/diagnostics`.
 *
 * Used by both React `InternalsContent` and Vue `InternalsTab` / `InternalsSection`.
 */
export interface DiagnosticsResponse {
  package: {
    version: string
    nodeVersion: string
    adonisVersion: string
    uptime?: number
  }
  config: {
    intervalMs: number
    transport: string
    channelName: string
    endpoint: string | false
    skipInTest: boolean
    hasOnStatsCallback: boolean
    hasShouldShowCallback: boolean
  }
  devToolbar: {
    enabled: boolean
    maxQueries: number
    maxEvents: number
    maxEmails: number
    maxTraces: number
    slowQueryThresholdMs: number
    tracing: boolean
    dashboard: boolean
    dashboardPath: string
    debugEndpoint: string
    retentionDays: number
    dbPath: string
    persistDebugData: boolean | string
    renderer: string
    excludeFromTracing: string[]
    customPaneCount: number
  }
  collectors: DiagnosticsCollectorInfo[]
  buffers: Record<string, DiagnosticsBufferInfo>
  timers: Record<string, DiagnosticsTimerInfo>
  transmit: {
    available: boolean
    channels: string[]
  }
  integrations: Record<string, { active?: boolean; available?: boolean; mode?: string }>
  storage: {
    ready: boolean
    dbPath: string
    fileSizeMb: number
    walSizeMb: number
    retentionDays: number
    tables: Array<{ name: string; rowCount: number }>
    lastCleanupAt: number | null
  } | null
  uptime?: number
}

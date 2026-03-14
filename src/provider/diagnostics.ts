/**
 * Pure function to build the diagnostics object for the Internals endpoint.
 * Extracted from ServerStatsProvider to reduce complexity.
 */

/** Minimal collector shape for diagnostics. */
interface CollectorRef {
  name: string
}

/** Input data for building diagnostics. */
export interface DiagnosticsInput {
  intervalId: ReturnType<typeof setInterval> | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
  debugBroadcastTimer: ReturnType<typeof setTimeout> | null
  flushTimer: ReturnType<typeof setInterval> | null
  dashboardStoreReady: boolean
  transmitAvailable: boolean
  transmitChannels: string[]
  prometheusActive: boolean
  pinoHookActive: boolean
  edgePluginActive: boolean
  emailBridgeActive: boolean
  hasCacheCollector?: boolean
  hasQueueCollector?: boolean
  resolvedCollectors?: CollectorRef[]
  config: DiagnosticsConfig | null
  /** Lucid connections that have debug: true (empty = no query events emitted). */
  lucidDebugConnections?: string[]
}

interface DiagnosticsConfig {
  intervalMs: number
  transport: string
  channelName: string
  endpoint: string | false
  skipInTest: boolean
  onStats?: unknown
  shouldShow?: unknown
  devToolbar?: DiagnosticsToolbar
}

interface DiagnosticsToolbar {
  enabled: boolean
  maxQueries?: number
  maxEvents?: number
  maxEmails?: number
  maxTraces?: number
  slowQueryThresholdMs?: number
  tracing?: boolean
  dashboard?: boolean
  dashboardPath?: string
  retentionDays?: number
  dbPath?: string
  persistDebugData?: boolean | string
  debugEndpoint?: string
  renderer?: string
  excludeFromTracing?: string[]
  panes?: unknown[]
}

function buildTimersDiagnostics(input: DiagnosticsInput) {
  return {
    collectionInterval: {
      active: input.intervalId !== null,
      intervalMs: input.config?.intervalMs ?? 0,
    },
    dashboardBroadcast: {
      active: input.dashboardBroadcastTimer !== null,
      intervalMs: 30_000,
    },
    debugBroadcast: {
      active: input.debugBroadcastTimer !== null,
      debounceMs: 200,
    },
    persistFlush: {
      active: input.flushTimer !== null,
      intervalMs: 30_000,
    },
    retentionCleanup: {
      active: input.dashboardStoreReady,
      intervalMs: 60 * 60 * 1000,
    },
  }
}

function buildIntegrationsDiagnostics(input: DiagnosticsInput) {
  const collectors = input.resolvedCollectors ?? []
  const hasCache = input.hasCacheCollector ?? collectors.some((c) => c.name === 'redis')
  const hasQueue = input.hasQueueCollector ?? collectors.some((c) => c.name === 'queue')
  return {
    prometheus: { active: input.prometheusActive },
    pinoHook: {
      active: input.pinoHookActive,
      mode: input.pinoHookActive ? 'stream' : 'none',
    },
    edgePlugin: { active: input.edgePluginActive },
    emailBridge: { active: input.emailBridgeActive },
    cacheInspector: { available: hasCache },
    queueInspector: { available: hasQueue },
  }
}

function buildConfigDiagnostics(config: DiagnosticsConfig | null) {
  if (!config) {
    return {
      intervalMs: 0,
      transport: 'none',
      channelName: '',
      endpoint: false as string | false,
      skipInTest: true,
      hasOnStatsCallback: false,
      hasShouldShowCallback: false,
    }
  }
  return {
    intervalMs: config.intervalMs,
    transport: config.transport,
    channelName: config.channelName,
    endpoint: config.endpoint,
    skipInTest: config.skipInTest !== false,
    hasOnStatsCallback: typeof config.onStats === 'function',
    hasShouldShowCallback: typeof config.shouldShow === 'function',
  }
}

function pickToolbarLimits(tb: DiagnosticsToolbar) {
  return {
    maxQueries: tb.maxQueries ?? 500,
    maxEvents: tb.maxEvents ?? 200,
    maxEmails: tb.maxEmails ?? 100,
    maxTraces: tb.maxTraces ?? 200,
    slowQueryThresholdMs: tb.slowQueryThresholdMs ?? 100,
  }
}

function pickToolbarPaths(tb: DiagnosticsToolbar) {
  return {
    dashboardPath: tb.dashboardPath ?? '/__stats',
    debugEndpoint: tb.debugEndpoint ?? '/admin/api/debug',
    dbPath: tb.dbPath ?? '.adonisjs/server-stats/dashboard.sqlite3',
  }
}

function pickToolbarFeatures(tb: DiagnosticsToolbar) {
  return {
    tracing: tb.tracing ?? true,
    dashboard: tb.dashboard ?? false,
    retentionDays: tb.retentionDays ?? 7,
    persistDebugData: tb.persistDebugData ?? false,
    renderer: tb.renderer ?? 'preact',
    excludeFromTracing: tb.excludeFromTracing ?? [],
    customPaneCount: tb.panes?.length ?? 0,
  }
}

function defaultToolbarDiagnostics() {
  return {
    enabled: false,
    ...pickToolbarLimits({} as DiagnosticsToolbar),
    ...pickToolbarPaths({} as DiagnosticsToolbar),
    ...pickToolbarFeatures({} as DiagnosticsToolbar),
  }
}

function buildDevToolbarDiagnostics(config: DiagnosticsConfig | null) {
  const tb = config?.devToolbar
  if (!tb) return defaultToolbarDiagnostics()
  return {
    enabled: !!tb.enabled,
    ...pickToolbarLimits(tb),
    ...pickToolbarPaths(tb),
    ...pickToolbarFeatures(tb),
  }
}

/**
 * Build the full diagnostics object from provider state.
 */
export function buildDiagnostics(input: DiagnosticsInput) {
  return {
    timers: buildTimersDiagnostics(input),
    transmit: {
      available: input.transmitAvailable,
      channels: input.transmitChannels,
    },
    integrations: buildIntegrationsDiagnostics(input),
    config: buildConfigDiagnostics(input.config),
    devToolbar: buildDevToolbarDiagnostics(input.config),
    lucidDebugConnections: input.lucidDebugConnections ?? [],
  }
}

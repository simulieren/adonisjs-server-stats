import { setVerbose } from './utils/logger.js'
import { logDeprecationWarnings } from './config/deprecation_migration.js'

import type { DevToolbarOptions, ResolvedServerStatsConfig, ServerStatsConfig } from './types.js'

// ---------------------------------------------------------------------------
// Toolbar alias resolution helpers
// ---------------------------------------------------------------------------

/** Apply toolbar config object fields onto the result. */
function applyToolbarConfig(
  toolbar: Exclude<ServerStatsConfig['toolbar'], boolean | undefined>,
  result: DevToolbarOptions
): void {
  result.enabled = true
  const fields: Array<[string, string]> = [
    ['slowQueryThreshold', 'slowQueryThresholdMs'],
    ['tracing', 'tracing'],
    ['persist', 'persistDebugData'],
    ['panes', 'panes'],
    ['excludeFromTracing', 'excludeFromTracing'],
  ]
  for (const [src, dst] of fields) {
    const v = (toolbar as Record<string, unknown>)[src]
    if (v !== undefined) (result as unknown as Record<string, unknown>)[dst] = v
  }
}

/** Apply dashboard config onto the result. */
function applyDashboardConfig(
  dashboard: ServerStatsConfig['dashboard'],
  result: DevToolbarOptions
): void {
  if (dashboard === true) {
    result.enabled = true
    result.dashboard = true
    return
  }
  if (dashboard && typeof dashboard === 'object') {
    result.enabled = true
    result.dashboard = true
    if (dashboard.path !== undefined) result.dashboardPath = dashboard.path
    if (dashboard.retentionDays !== undefined) result.retentionDays = dashboard.retentionDays
  }
}

/** Advanced config field mappings. */
const ADVANCED_FIELDS: Array<[string, string]> = [
  ['debugEndpoint', 'debugEndpoint'],
  ['renderer', 'renderer'],
  ['dbPath', 'dbPath'],
  ['maxQueries', 'maxQueries'],
  ['maxEvents', 'maxEvents'],
  ['maxEmails', 'maxEmails'],
  ['maxTraces', 'maxTraces'],
]

/** Apply advanced config onto the result. */
function applyAdvancedConfig(
  advanced: ServerStatsConfig['advanced'],
  result: DevToolbarOptions
): void {
  if (!advanced) return
  for (const [src, dst] of ADVANCED_FIELDS) {
    const v = (advanced as Record<string, unknown>)[src]
    if (v !== undefined) (result as unknown as Record<string, unknown>)[dst] = v
  }
  if (advanced.persistPath !== undefined) {
    result.persistDebugData = advanced.persistPath
  }
}

/**
 * Resolve `toolbar`, `dashboard`, and `advanced` aliases into a
 * {@link DevToolbarOptions} object.
 */
function resolveToolbarAliases(
  config: ServerStatsConfig,
  existing?: DevToolbarOptions
): DevToolbarOptions {
  const result: DevToolbarOptions = { ...existing, enabled: existing?.enabled ?? false }

  if (config.toolbar === true) {
    result.enabled = true
  } else if (config.toolbar && typeof config.toolbar === 'object') {
    applyToolbarConfig(config.toolbar, result)
  } else if (config.toolbar === false) {
    result.enabled = false
  }

  applyDashboardConfig(config.dashboard, result)
  applyAdvancedConfig(config.advanced, result)

  return result
}

// ---------------------------------------------------------------------------
// Config resolution helpers
// ---------------------------------------------------------------------------

/** Resolve transport from new and deprecated config options. */
function resolveTransport(config: ServerStatsConfig): 'transmit' | 'none' {
  if (config.realtime !== undefined) {
    return config.realtime ? 'transmit' : 'none'
  }
  return config.transport ?? 'transmit'
}

/** Resolve devToolbar from aliases. */
function resolveDevToolbar(config: ServerStatsConfig): DevToolbarOptions | undefined {
  const hasAliases =
    config.toolbar !== undefined ||
    config.dashboard !== undefined ||
    config.advanced !== undefined
  if (hasAliases) return resolveToolbarAliases(config, config.devToolbar)
  return config.devToolbar
}

// ---------------------------------------------------------------------------
// Main defineConfig
// ---------------------------------------------------------------------------

/**
 * Define the server stats configuration with full type safety.
 *
 * All fields are optional. Sensible defaults are applied for anything
 * you omit -- `defineConfig({})` works out of the box with zero config.
 *
 * @example
 * ```ts
 * // Zero config -- auto-detects everything
 * import { defineConfig } from 'adonisjs-server-stats'
 * export default defineConfig({})
 * ```
 *
 * @example
 * ```ts
 * // Common setup with auth and all features
 * import { defineConfig } from 'adonisjs-server-stats'
 *
 * export default defineConfig({
 *   authorize: (ctx) => ctx.auth?.user?.role === 'admin',
 *   toolbar: true,
 *   dashboard: true,
 * })
 * ```
 */
/** Resolve a value from primary, fallback, then default. */
function first<T>(primary: T | undefined, fallback: T | undefined, defaultVal: T): T {
  return primary ?? fallback ?? defaultVal
}

export function defineConfig(config: ServerStatsConfig): ResolvedServerStatsConfig {
  const verbose = config.verbose ?? false
  setVerbose(verbose)
  logDeprecationWarnings(config)

  return {
    intervalMs: first(config.pollInterval, config.intervalMs, 3000),
    transport: resolveTransport(config),
    channelName: first(config.advanced?.channelName, config.channelName, 'admin/server-stats'),
    endpoint: first(config.statsEndpoint, config.endpoint, '/admin/api/server-stats'),
    collectors: config.collectors ?? 'auto',
    skipInTest: first(config.advanced?.skipInTest, config.skipInTest, true as boolean),
    onStats: config.onStats,
    devToolbar: resolveDevToolbar(config),
    shouldShow: config.authorize ?? config.shouldShow,
    verbose,
  }
}

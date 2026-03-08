// ---------------------------------------------------------------------------
// Helpers extracted from define_config.ts to reduce complexity
// ---------------------------------------------------------------------------

import type { DevToolbarOptions, ServerStatsConfig, ToolbarConfig } from '../types.js'

/**
 * Return the first defined (non-undefined) value from the arguments.
 * Falls back to the last argument (the default).
 */
export function firstDefined<T>(...args: Array<T | undefined>): T {
  for (const arg of args) {
    if (arg !== undefined) return arg
  }
  return args[args.length - 1] as T
}

/** Check if a value is a non-null non-array object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Apply a toolbar boolean or ToolbarConfig onto the result DevToolbarOptions.
 */
export function applyToolbarSetting(
  toolbar: boolean | ToolbarConfig,
  result: DevToolbarOptions
): void {
  if (toolbar === false) {
    result.enabled = false
    return
  }
  result.enabled = true
  if (toolbar === true) return

  // toolbar is ToolbarConfig
  if (toolbar.slowQueryThreshold !== undefined)
    result.slowQueryThresholdMs = toolbar.slowQueryThreshold
  if (toolbar.tracing !== undefined) result.tracing = toolbar.tracing
  if (toolbar.persist !== undefined) result.persistDebugData = toolbar.persist
  if (toolbar.panes !== undefined) result.panes = toolbar.panes
  if (toolbar.excludeFromTracing !== undefined)
    result.excludeFromTracing = toolbar.excludeFromTracing
}

/**
 * Apply a dashboard boolean or DashboardConfig onto the result DevToolbarOptions.
 */
export function applyDashboardSetting(
  dashboard: boolean | { path?: string; retentionDays?: number },
  result: DevToolbarOptions
): void {
  result.enabled = true
  result.dashboard = true
  if (dashboard === true) return
  if (!isPlainObject(dashboard)) return
  if (dashboard.path !== undefined) result.dashboardPath = dashboard.path as string
  if (dashboard.retentionDays !== undefined)
    result.retentionDays = dashboard.retentionDays as number
}

/** Field mapping for advanced config -> DevToolbarOptions. */
interface AdvancedFieldMap {
  from: keyof NonNullable<ServerStatsConfig['advanced']>
  to: keyof DevToolbarOptions
}

const ADVANCED_FIELD_MAP: AdvancedFieldMap[] = [
  { from: 'debugEndpoint', to: 'debugEndpoint' },
  { from: 'renderer', to: 'renderer' },
  { from: 'dbPath', to: 'dbPath' },
  { from: 'maxQueries', to: 'maxQueries' },
  { from: 'maxEvents', to: 'maxEvents' },
  { from: 'maxEmails', to: 'maxEmails' },
  { from: 'maxTraces', to: 'maxTraces' },
]

/**
 * Apply advanced config fields onto the result DevToolbarOptions.
 */
export function applyAdvancedConfig(
  advanced: NonNullable<ServerStatsConfig['advanced']>,
  result: DevToolbarOptions
): void {
  for (const { from, to } of ADVANCED_FIELD_MAP) {
    const value = advanced[from]
    if (value !== undefined) {
      ;(result as Record<string, unknown>)[to] = value
    }
  }
  if (advanced.persistPath !== undefined) {
    result.persistDebugData = advanced.persistPath
  }
}

/**
 * Resolve transport from new and deprecated config options.
 */
export function resolveTransport(config: ServerStatsConfig): 'transmit' | 'none' {
  if (config.realtime !== undefined) {
    return config.realtime ? 'transmit' : 'none'
  }
  return config.transport ?? 'transmit'
}

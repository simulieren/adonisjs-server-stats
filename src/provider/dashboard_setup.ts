/**
 * Pure helper functions for dashboard setup and configuration.
 */

import type { DevToolbarConfig } from '../debug/types.js'

const MISSING_DEP_MARKERS = [
  'better-sqlite3',
  'knex',
  'Cannot find module',
  'Cannot find package',
]

const MISSING_DEP_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

function isMissingDependencyError(msg: string, code: string): boolean {
  if (MISSING_DEP_CODES.has(code)) return true
  return MISSING_DEP_MARKERS.some((marker) => msg.includes(marker))
}

/**
 * Classify a dashboard start() error into a category.
 */
export function classifyDashboardError(
  err: unknown
): 'missing-dep' | 'timeout' | 'unknown' {
  if (!err) return 'unknown'
  const errObj = err as Record<string, unknown>
  const msg = typeof errObj.message === 'string' ? errObj.message : ''
  const code = typeof errObj.code === 'string' ? errObj.code : ''
  if (isMissingDependencyError(msg, code)) return 'missing-dep'
  if (msg.includes('timed out')) return 'timeout'
  return 'unknown'
}

/**
 * Race a promise against a timeout.
 */
export function createStartTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Dashboard SQLite initialization timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    )
  })
  return Promise.race([promise, timeoutPromise])
}

/**
 * Build the list of URL prefixes to exclude from tracing.
 */
export function buildExcludedPrefixes(
  toolbarConfig: {
    debugEndpoint?: string
    excludeFromTracing?: string[]
  },
  statsEndpoint: string | false
): string[] {
  const debugEndpoint = toolbarConfig.debugEndpoint ?? '/admin/api/debug'
  const defaultExcludes = [debugEndpoint, statsEndpoint].filter(
    (p): p is string => typeof p === 'string'
  )
  const prefixes: string[] = [
    ...(toolbarConfig.excludeFromTracing ?? defaultExcludes),
  ]
  if (typeof statsEndpoint === 'string' && !prefixes.includes(statsEndpoint)) {
    prefixes.push(statsEndpoint)
  }
  return prefixes
}

const TOOLBAR_DEFAULTS: Omit<DevToolbarConfig, 'enabled'> = {
  maxQueries: 500,
  maxEvents: 200,
  maxEmails: 100,
  slowQueryThresholdMs: 100,
  persistDebugData: false,
  tracing: true,
  maxTraces: 200,
  dashboard: false,
  dashboardPath: '/__stats',
  retentionDays: 7,
  dbPath: '.adonisjs/server-stats/dashboard.sqlite3',
  debugEndpoint: '/admin/api/debug',
}

function stripUndefined<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result as Partial<T>
}

/**
 * Resolve a partial DevToolbarConfig by filling in all defaults.
 */
export function resolveToolbarConfig(
  partial: Partial<DevToolbarConfig> & { enabled: boolean }
): DevToolbarConfig {
  return {
    ...TOOLBAR_DEFAULTS,
    ...stripUndefined(partial),
  }
}

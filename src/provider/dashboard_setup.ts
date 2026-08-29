/**
 * Pure helper functions for dashboard setup and configuration.
 */

import type { DevToolbarConfig, ResolvedCapture } from '../debug/types.js'
import type { CaptureConfig, ProductionConfig } from '../types.js'

const MISSING_DEP_MARKERS = ['better-sqlite3', 'knex', 'Cannot find module', 'Cannot find package']

const MISSING_DEP_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

function isMissingDependencyError(msg: string, code: string): boolean {
  if (MISSING_DEP_CODES.has(code)) return true
  return MISSING_DEP_MARKERS.some((marker) => msg.includes(marker))
}

/**
 * Classify a dashboard start() error into a category.
 */
export function classifyDashboardError(err: unknown): 'missing-dep' | 'timeout' | 'unknown' {
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
export function createStartTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`Dashboard SQLite initialization timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    )
  })
  // Clear the timer once the race settles so a winning primary promise doesn't
  // leave a dangling 15s timer that keeps the event loop alive (blocks clean
  // test exit).
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
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
  const prefixes: string[] = [...(toolbarConfig.excludeFromTracing ?? defaultExcludes)]
  if (typeof statsEndpoint === 'string' && !prefixes.includes(statsEndpoint)) {
    prefixes.push(statsEndpoint)
  }
  return prefixes
}

const TOOLBAR_DEFAULTS: Omit<DevToolbarConfig, 'enabled' | 'capture'> = {
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
  maxDbSizeMb: 500,
  dbPath: '.adonisjs/server-stats/dashboard.sqlite3',
  debugEndpoint: '/admin/api/debug',
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result as Partial<T>
}

/** Retention default when running in production — shorter than the usual 7 days. */
const PRODUCTION_RETENTION_DAYS = 3

/** Environment context needed to resolve production-sensitive defaults. */
export interface ProductionContext {
  inProduction: boolean
  production?: ProductionConfig
}

/**
 * Resolve which capture subsystems subscribe.
 *
 * Outside production everything captures, as it always has. In production every
 * subsystem is off until asked for by name, because each one is the expensive,
 * secret-adjacent half of this package: query bindings, mail bodies, log lines.
 *
 * `tracing: false` still wins over `capture.traces` — it is the pre-existing
 * documented kill switch and must not be quietly re-enabled.
 */
function resolveCapture(ctx: ProductionContext | undefined, tracing: boolean): ResolvedCapture {
  const inProduction = ctx?.inProduction === true
  const requested: CaptureConfig = (inProduction ? ctx?.production?.capture : undefined) ?? {}
  const isOn = (key: keyof CaptureConfig): boolean => requested[key] ?? !inProduction
  return {
    queries: isOn('queries'),
    events: isOn('events'),
    emails: isOn('emails'),
    traces: tracing && isOn('traces'),
    logs: isOn('logs'),
  }
}

/**
 * Resolve retention, preferring an explicit value from any source over the
 * production default. Order: `production.retentionDays`, then whatever
 * `dashboard`/`advanced` set, then 3 days in production, then 7.
 */
function resolveRetentionDays(
  ctx: ProductionContext | undefined,
  explicit: number | undefined
): number {
  const fromProduction = ctx?.inProduction ? ctx.production?.retentionDays : undefined
  if (fromProduction !== undefined) return fromProduction
  if (explicit !== undefined) return explicit
  return ctx?.inProduction ? PRODUCTION_RETENTION_DAYS : TOOLBAR_DEFAULTS.retentionDays
}

/**
 * Resolve the database size cap. Order: `production.maxDbSizeMb` when in
 * production, then whatever `dashboard` set, then the 500 MB default.
 */
function resolveMaxDbSizeMb(ctx: ProductionContext | undefined, explicit: number | undefined) {
  const fromProduction = ctx?.inProduction ? ctx.production?.maxDbSizeMb : undefined
  if (fromProduction !== undefined) return fromProduction
  if (explicit !== undefined) return explicit
  return TOOLBAR_DEFAULTS.maxDbSizeMb
}

/**
 * Resolve a partial DevToolbarConfig by filling in all defaults.
 *
 * Pass `ctx` to apply production-sensitive defaults (capture off, shorter
 * retention). Omitting it resolves as a non-production environment.
 */
export function resolveToolbarConfig(
  partial: Partial<DevToolbarConfig> & { enabled: boolean },
  ctx?: ProductionContext
): DevToolbarConfig {
  const merged = {
    ...TOOLBAR_DEFAULTS,
    ...stripUndefined(partial),
    enabled: partial.enabled,
  }
  return {
    ...merged,
    retentionDays: resolveRetentionDays(ctx, partial.retentionDays),
    maxDbSizeMb: resolveMaxDbSizeMb(ctx, partial.maxDbSizeMb),
    capture: resolveCapture(ctx, merged.tracing),
  }
}

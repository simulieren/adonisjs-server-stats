/**
 * Provider helper functions extracted from ServerStatsProvider.
 * Handles pino hooking, log stream broadcast, stats interval,
 * dependency checking, edge plugin, and non-web bridge.
 *
 * Dashboard/toolbar setup is in ./toolbar_setup.ts and re-exported here.
 */

import { getLogStreamService } from '../collectors/log_collector.js'
import { LogStreamService } from '../log_stream/log_stream_service.js'
import { log, dim, bold } from '../utils/logger.js'
import { setupPublisherOnlyBridge } from './email_bridge.js'
import { findPinoStreamSymbol, wrapWriteMethod } from './pino_hook.js'
// Re-export toolbar/dashboard functions with provider-compatible signatures
import {
  setupDevToolbarCore as coreSetup,
  applyToolbarResult as coreApply,
} from './toolbar_setup.js'

import type { DevToolbarConfig } from '../debug/types.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ToolbarCoreResult, ProviderFields } from './toolbar_setup.js'
import type { ApplicationService } from '@adonisjs/core/types'

export { initDashboardStore } from './dashboard_init.js'

interface SetupDevToolbarArgs {
  tc: DevToolbarConfig
  config: ResolvedServerStatsConfig
  app: ApplicationService
  resolve: (binding: string) => Promise<unknown>
  getDiagnostics: () => unknown
}

/** Wrapper matching the provider's call signature. */
export async function setupDevToolbarCore(
  args: SetupDevToolbarArgs
): Promise<ToolbarCoreResult | null> {
  return coreSetup(args)
}

/** Wrapper matching the provider's 3-arg call signature. */
export function applyToolbarResult(
  result: ToolbarCoreResult,
  tc: DevToolbarConfig,
  provider: ProviderFields
): void {
  coreApply(result, tc, provider)
}

// ── hookPinoToLogStream ─────────────────────────────────────────

/** Hook the AdonisJS Pino logger into the log collector. Returns true if hooked. */
export function hookPinoToLogStream(logger: unknown): boolean {
  const logStream = getLogStreamService()
  if (!logStream) return false
  const pino = (logger as Record<string, unknown> | null)?.pino
  if (!pino) return false
  const streamSym = findPinoStreamSymbol(pino as object)
  if (!streamSym) return false
  const rawStream = (pino as Record<symbol, unknown>)[streamSym]
  if (!rawStream) return false
  if (typeof (rawStream as Record<string, unknown>).write !== 'function') return false
  wrapWriteMethod(rawStream as { write: Function; [key: string]: unknown }, (entry) =>
    logStream.ingest(entry)
  )
  log.info('log collector hooked into AdonisJS logger (zero-config)')
  return true
}

// ── setupLogStreamBroadcast ─────────────────────────────────────

/** Set up log stream broadcasting via Transmit. Returns LogStreamService if file-based fallback. */
export function setupLogStreamBroadcast(
  transmit: { broadcast(ch: string, d: unknown): void },
  channelName: string,
  pinoHookActive: boolean,
  makePath: (...parts: string[]) => string
): LogStreamService | null {
  const broadcast = (entry: Record<string, unknown>) => {
    try {
      transmit.broadcast(channelName, entry)
    } catch {}
  }
  const existing = getLogStreamService()
  if (pinoHookActive && existing) {
    const internal = existing as unknown as { onEntry?: (entry: Record<string, unknown>) => void }
    const orig = internal.onEntry
    internal.onEntry = (entry: Record<string, unknown>) => {
      orig?.(entry)
      broadcast(entry)
    }
    return null
  }
  const service = new LogStreamService(makePath('logs', 'adonisjs.log'), broadcast)
  service.start().catch(() => {})
  return service
}

// ── checkDashboardDepsHelper ────────────────────────────────────

/** Check if dashboard dependencies are available. Returns true if available, false if missing. */
export async function checkDashboardDepsHelper(
  config: ResolvedServerStatsConfig,
  _app: ApplicationService
): Promise<boolean> {
  if (!config.devToolbar?.enabled || !config.devToolbar.dashboard) return true
  const { appImport } = await import('../utils/app_import.js')
  const missing: string[] = []
  try {
    await appImport('knex')
  } catch {
    missing.push('knex')
  }
  try {
    await appImport('better-sqlite3')
  } catch {
    missing.push('better-sqlite3')
  }
  if (missing.length === 0) return true
  log.block(`Dashboard requires ${missing.join(' and ')}. Install with:`, [
    '',
    bold(`npm install ${missing.join(' ')}`),
    '',
    dim('Dashboard routes have been skipped for now.'),
    dim('Everything else (stats bar, debug panel) works without it.'),
  ])
  return false
}

// ── registerEdgePluginHelper ────────────────────────────────────

/** Register the Edge.js plugin if Edge is available. Returns true if registered. */
export async function registerEdgePluginHelper(
  app: ApplicationService,
  config: ResolvedServerStatsConfig
): Promise<boolean> {
  if (!app.usingEdgeJS) return false
  try {
    const { appImport } = await import('../utils/app_import.js')
    const edge = await appImport<typeof import('edge.js')>('edge.js')
    const { edgePluginServerStats } = await import('../edge/plugin.js')
    edge.default.use(edgePluginServerStats(config))
    return true
  } catch (err) {
    log.warn('could not register Edge plugin: ' + (err as Error)?.message)
    return false
  }
}

// ── setupNonWebBridgeHelper ─────────────────────────────────────

/** Set up the publisher-only email bridge for non-web environments. */
export async function setupNonWebBridgeHelper(emitter: unknown, channel: string): Promise<void> {
  if (!emitter) return
  try {
    const { appImport } = await import('../utils/app_import.js')
    const mod = await appImport<typeof import('@adonisjs/redis/services/main')>(
      '@adonisjs/redis/services/main'
    )
    const redis = mod.default as { publish(c: string, m: string): Promise<unknown> }
    setupPublisherOnlyBridge(
      emitter as { on(e: string, h: (...a: unknown[]) => void): void },
      redis,
      channel
    )
  } catch {
    // Redis not available — skip bridge
  }
}

// ── setupStatsIntervalHelper ────────────────────────────────────

interface StatsIntervalResult {
  intervalId: ReturnType<typeof setInterval>
  transmitAvailable: boolean
  prometheusActive: boolean
  channelName: string | null
}

/** Set up the stats collection interval with transmit and prometheus integration. */
export async function setupStatsIntervalHelper(
  engine: StatsEngine,
  config: ResolvedServerStatsConfig,
  container: { make(b: string): Promise<unknown> }
): Promise<StatsIntervalResult> {
  const { transmit, transmitAvailable } = await resolveTransmit(config, container)
  const { prom, prometheusActive } = await resolvePrometheus()
  const intervalId = setInterval(async () => {
    try {
      const s = await engine.collect()
      if (transmit && config.channelName)
        (transmit as { broadcast: Function }).broadcast(config.channelName, s)
      if (prom) (prom as { update: Function }).update(s)
      config.onStats?.(s)
    } catch {}
  }, config.intervalMs)
  return {
    intervalId,
    transmitAvailable,
    prometheusActive,
    channelName: transmitAvailable ? config.channelName : null,
  }
}

async function resolveTransmit(
  config: ResolvedServerStatsConfig,
  container: { make(b: string): Promise<unknown> }
) {
  if (config.transport !== 'transmit') return { transmit: null, transmitAvailable: false }
  try {
    const t = await container.make('transmit')
    return t
      ? { transmit: t, transmitAvailable: true }
      : { transmit: null, transmitAvailable: false }
  } catch {
    log.info('transmit not installed — falling back to polling')
    return { transmit: null, transmitAvailable: false }
  }
}

async function resolvePrometheus() {
  try {
    const m = await import('../prometheus/prometheus_collector.js')
    const p = m.ServerStatsCollector.instance
    if (p) {
      log.info('Prometheus integration active')
      return { prom: p, prometheusActive: true }
    }
  } catch {}
  return { prom: null, prometheusActive: false }
}

/**
 * Dev toolbar and dashboard setup helpers extracted from provider.
 */

import { setTraceCollector } from '../middleware/request_tracking_middleware.js'
import { log } from '../utils/logger.js'
import { initDashboardStore } from './dashboard_init.js'
import { setupFullEmailBridge } from './email_bridge.js'

import type DebugController from '../controller/debug_controller.js'
import type DashboardController from '../dashboard/dashboard_controller.js'
import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { DevToolbarConfig } from '../debug/types.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { LogStreamService } from '../log_stream/log_stream_service.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { ApplicationService } from '@adonisjs/core/types'

export { initDashboardStore } from './dashboard_init.js'

// ── setupDevToolbarCore ─────────────────────────────────────────

export interface ToolbarCoreResult {
  debugStore: DebugStore
  debugController: DebugController
  persistPath: string | null
  flushTimer: ReturnType<typeof setInterval> | null
  debugBroadcastTimer: ReturnType<typeof setTimeout> | null
  transmitAvailable: boolean
  transmitChannels: string[]
  dashboardStore: DashboardStore | null
  dashboardController: DashboardController | null
  dashboardLogStream: LogStreamService | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
  emailBridgeRedis: unknown
  emitter: unknown
}

interface ToolbarCoreOptions {
  tc: DevToolbarConfig
  config: ResolvedServerStatsConfig
  app: ApplicationService
  resolve: (binding: string) => Promise<unknown>
  getDiagnostics: () => unknown
}

/** Core dev toolbar setup: debug store, controllers, broadcasting, dashboard. */
export async function setupDevToolbarCore(
  opts: ToolbarCoreOptions
): Promise<ToolbarCoreResult | null> {
  const { tc, config, app, resolve, getDiagnostics } = opts
  const { DebugStore: DS } = await import('../debug/debug_store.js')
  const debugStore = new DS(tc) as DebugStore
  const container = app.container as unknown as { singleton(b: string, f: () => unknown): void }
  container.singleton('debug.store', () => debugStore)
  const persistPath = await loadPersistedData(tc, app, debugStore)
  const em = await resolve('emitter')
  if (!em) log.warn('emitter not available — query/event collection disabled')
  await debugStore.start(em, await resolve('router'))
  const emailBridgeRedis = await setupBridgeInternal(em, debugStore)
  const debugController = await createDebugController(debugStore, config, getDiagnostics, app)
  if (debugStore.traces) setTraceCollector(debugStore.traces)
  const flushTimer = persistPath ? createFlushTimer(debugStore, persistPath) : null
  const broadcast = await setupDebugBroadcastInternal(debugStore, resolve)
  return {
    debugStore,
    debugController,
    persistPath,
    flushTimer,
    debugBroadcastTimer: broadcast.timer,
    transmitAvailable: broadcast.transmitAvailable,
    transmitChannels: broadcast.channels,
    dashboardStore: null,
    dashboardController: null,
    dashboardLogStream: null,
    dashboardBroadcastTimer: null,
    emailBridgeRedis,
    emitter: em,
  }
}

async function loadPersistedData(
  tc: DevToolbarConfig,
  app: ApplicationService,
  debugStore: DebugStore
): Promise<string | null> {
  if (!tc.persistDebugData) return null
  const path =
    typeof tc.persistDebugData === 'string'
      ? app.makePath(tc.persistDebugData)
      : app.makePath('.adonisjs', 'server-stats', 'debug-data.json')
  await debugStore.loadFromDisk(path)
  return path
}

async function createDebugController(
  debugStore: DebugStore,
  config: ResolvedServerStatsConfig,
  getDiagnostics: () => unknown,
  app: ApplicationService
): Promise<DebugController> {
  const DC = (await import('../controller/debug_controller.js')).default
  return new DC(debugStore, config, {
    getEngine: () => null,
    getDashboardStore: () => null,
    getProviderDiagnostics: getDiagnostics as () => Record<string, unknown>,
    getApp: () => app,
  })
}

function createFlushTimer(
  debugStore: DebugStore,
  persistPath: string
): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      await debugStore.saveToDisk(persistPath)
    } catch {}
  }, 30_000)
}

async function setupBridgeInternal(emitter: unknown, debugStore: DebugStore): Promise<unknown> {
  if (!emitter) return null
  try {
    const { appImport } = await import('../utils/app_import.js')
    const mod = await appImport<typeof import('@adonisjs/redis/services/main')>(
      '@adonisjs/redis/services/main'
    )
    const redis = mod.default as {
      publish(c: string, m: string): Promise<unknown>
      subscribe(c: string, h: (m: string) => void): unknown
    }
    return await setupFullEmailBridge(
      emitter as { on(e: string, h: (...a: unknown[]) => void): void },
      redis,
      'adonisjs-server-stats:emails',
      { debugEmails: debugStore.emails ?? null, dashboardStore: null }
    )
  } catch {
    return null
  }
}

async function setupDebugBroadcastInternal(
  debugStore: DebugStore,
  resolve: (binding: string) => Promise<unknown>
): Promise<{
  timer: ReturnType<typeof setTimeout> | null
  transmitAvailable: boolean
  channels: string[]
}> {
  const t = await resolve('transmit')
  if (!t) return { timer: null, transmitAvailable: false, channels: [] }
  const ch = 'server-stats/debug'
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  debugStore.onNewItem((type: string) => {
    pending.add(type)
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      const ts = [...pending]
      pending.clear()
      try {
        ;(t as { broadcast: Function }).broadcast(ch, { types: ts })
      } catch {}
    }, 200)
  })
  return { timer: null, transmitAvailable: true, channels: [ch] }
}

// ── applyToolbarResult ──────────────────────────────────────────

export interface ProviderFields {
  debugStore: DebugStore | null
  debugController: DebugController | null
  persistPath: string | null
  flushTimer: ReturnType<typeof setInterval> | null
  debugBroadcastTimer: ReturnType<typeof setTimeout> | null
  transmitAvailable: boolean
  transmitChannels: string[]
  dashboardStore: DashboardStore | null
  dashboardController: DashboardController | null
  dashboardLogStream: LogStreamService | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
  emailBridgeRedis: unknown
  dashboardDepsAvailable: boolean
  engine: StatsEngine | null
  pinoHookActive: boolean
  app: ApplicationService
}

/** Apply the toolbar core result back onto the provider instance. */
export function applyToolbarResult(
  result: ToolbarCoreResult,
  tc: DevToolbarConfig,
  provider: ProviderFields
): void {
  provider.debugStore = result.debugStore
  provider.debugController = result.debugController
  provider.persistPath = result.persistPath
  provider.flushTimer = result.flushTimer
  provider.debugBroadcastTimer = result.debugBroadcastTimer
  if (result.transmitAvailable) provider.transmitAvailable = true
  for (const ch of result.transmitChannels) {
    if (!provider.transmitChannels.includes(ch)) provider.transmitChannels.push(ch)
  }
  provider.emailBridgeRedis = result.emailBridgeRedis
  if (!tc.dashboard || !provider.dashboardDepsAvailable) return
  setImmediate(() => {
    initDashboardStore({
      tc,
      emitter: result.emitter,
      app: provider.app,
      debugStore: result.debugStore,
      engine: provider.engine!,
      pinoHookActive: provider.pinoHookActive,
      transmitChannels: provider.transmitChannels,
      onResult: (r) => {
        provider.dashboardStore = r.dashboardStore
        provider.dashboardController = r.dashboardController
        provider.dashboardLogStream = r.dashboardLogStream
        provider.dashboardBroadcastTimer = r.dashboardBroadcastTimer
      },
    }).catch((e) => {
      log.warn(`dashboard setup failed: ${(e as Error)?.message ?? e}`)
    })
  })
}

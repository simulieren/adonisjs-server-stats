import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { ConfigInspector } from '../dashboard/integrations/config_inspector.js'

import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'

interface DiagnosticsDeps {
  getEngine?: () => StatsEngine | null
  getDashboardStore?: () => DashboardStore | null
  getProviderDiagnostics?: () => Record<string, unknown>
  getApp?: () => ApplicationService
}

/** Maps collector name to feature key for data-driven feature detection. */
const COLLECTOR_FEATURE_MAP: Array<[string, string]> = [
  ['process', 'process'],
  ['system', 'system'],
  ['http', 'http'],
  ['db_pool', 'db'],
  ['redis', 'redis'],
  ['queue', 'queues'],
  ['redis', 'cache'],
  ['app', 'app'],
  ['log', 'log'],
]

/** Build collector-based feature flags from config. */
function buildCollectorFeatures(
  isAuto: boolean,
  collectorNames: Set<string>
): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const [collector, feature] of COLLECTOR_FEATURE_MAP) {
    result[feature] = isAuto || collectorNames.has(collector)
  }
  return result
}

/** Build toolbar-related feature flags. */
function buildToolbarFeatures(
  config: ResolvedServerStatsConfig | undefined
): Record<string, boolean> {
  const enabled = !!config?.devToolbar?.enabled
  return {
    statsBar: true,
    debugPanel: enabled,
    dashboard: !!config?.devToolbar?.dashboard,
    tracing: !!(config && (config.devToolbar?.tracing ?? true)),
    emails: enabled,
  }
}

/** Build combined features object from config. */
function buildFeaturesFromConfig(
  config: ResolvedServerStatsConfig | undefined
): Record<string, boolean> {
  const rawCollectors = config?.collectors
  const isAuto = rawCollectors === 'auto'
  const collectorNames = new Set(
    Array.isArray(rawCollectors) ? rawCollectors.map((c) => c.name) : []
  )
  return {
    ...buildToolbarFeatures(config),
    ...buildCollectorFeatures(isAuto, collectorNames),
  }
}

/** Build endpoint paths from config. */
function buildEndpoints(config: ResolvedServerStatsConfig | undefined): Record<string, string> {
  return {
    stats: typeof config?.endpoint === 'string' ? config.endpoint : '/admin/api/server-stats',
    debug: config?.devToolbar?.debugEndpoint ?? '/admin/api/debug',
    dashboard: config?.devToolbar?.dashboardPath ?? '/__stats',
  }
}

/** Build collector health + config info from engine. */
function buildCollectorInfo(engine: StatsEngine | null | undefined): unknown[] {
  const healthList = engine?.getCollectorHealth() ?? []
  const configList = engine?.getCollectorConfigs() ?? []
  const configMap = new Map(configList.map((c) => [c.name, c.config]))
  return healthList.map((h) => ({ ...h, config: configMap.get(h.name) ?? {} }))
}

/** Fetch storage stats, returning null on error. */
async function fetchStorageStats(
  dashboardStore: DashboardStore | null | undefined
): Promise<unknown> {
  if (!dashboardStore) return null
  try {
    return await dashboardStore.getStorageStats()
  } catch {
    return null
  }
}

export default class DebugController {
  private diagnosticsDeps: DiagnosticsDeps
  private configInspector: ConfigInspector | null = null
  private cachedPackageVersion: string | null = null
  private cachedAdonisVersion: string | null = null

  constructor(
    private store: DebugStore,
    private serverConfig?: ResolvedServerStatsConfig,
    diagnosticsDeps?: DiagnosticsDeps
  ) {
    this.diagnosticsDeps = diagnosticsDeps ?? {}
  }

  async config({ response }: HttpContext) {
    const cfg = this.serverConfig
    const inspector = this.getConfigInspector()
    return response.json({
      features: buildFeaturesFromConfig(cfg),
      customPanes: cfg?.devToolbar?.panes ?? [],
      endpoints: buildEndpoints(cfg),
      transmit: { channelName: cfg?.channelName ?? 'admin/server-stats' },
      app: inspector ? inspector.getConfig().config : {},
      env: inspector ? inspector.getEnvVars().env : {},
    })
  }

  private getConfigInspector(): ConfigInspector | null {
    if (this.configInspector) return this.configInspector
    const app = this.diagnosticsDeps.getApp?.()
    if (!app) return null
    this.configInspector = new ConfigInspector(app)
    return this.configInspector
  }

  private async cacheVersions(): Promise<void> {
    if (!this.cachedPackageVersion) {
      try {
        const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
        const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8'))
        this.cachedPackageVersion = pkgJson.version
      } catch {
        this.cachedPackageVersion = 'unknown'
      }
    }
    if (!this.cachedAdonisVersion) {
      try {
        const { appImport } = await import('../utils/app_import.js')
        const adonisPkg = await appImport<{ version: string }>('@adonisjs/core/package.json')
        this.cachedAdonisVersion = adonisPkg.version
      } catch {
        this.cachedAdonisVersion = 'unknown'
      }
    }
  }

  async diagnostics({ response }: HttpContext) {
    await this.cacheVersions()
    const engine = this.diagnosticsDeps.getEngine?.()
    const dashboardStore = this.diagnosticsDeps.getDashboardStore?.()
    const providerDiag = this.diagnosticsDeps.getProviderDiagnostics?.() ?? {}
    return response.json({
      package: {
        version: this.cachedPackageVersion,
        nodeVersion: process.version,
        adonisVersion: this.cachedAdonisVersion,
        uptime: process.uptime(),
      },
      ...providerDiag,
      collectors: buildCollectorInfo(engine),
      buffers: this.store.getBufferStats(),
      storage: await fetchStorageStats(dashboardStore),
    })
  }
}

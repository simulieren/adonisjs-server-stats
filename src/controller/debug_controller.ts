import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import type { DashboardStore } from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { StatsEngine } from '../engine/stats_engine.js'
import type { ResolvedServerStatsConfig } from '../types.js'
import type { HttpContext } from '@adonisjs/core/http'

interface DiagnosticsDeps {
  getEngine?: () => StatsEngine | null
  getDashboardStore?: () => DashboardStore | null
  getProviderDiagnostics?: () => Record<string, unknown>
}

export default class DebugController {
  private diagnosticsDeps: DiagnosticsDeps

  constructor(
    private store: DebugStore,
    private serverConfig?: ResolvedServerStatsConfig,
    diagnosticsDeps?: DiagnosticsDeps
  ) {
    this.diagnosticsDeps = diagnosticsDeps ?? {}
  }

  async config({ response }: HttpContext) {
    const cfg = this.serverConfig
    const toolbarConfig = cfg?.devToolbar

    // Derive feature flags from the actual config
    const rawCollectors = cfg?.collectors
    const collectorNames = new Set(
      Array.isArray(rawCollectors) ? rawCollectors.map((c) => c.name) : []
    )

    const features = {
      statsBar: true,
      debugPanel: !!toolbarConfig?.enabled,
      dashboard: !!toolbarConfig?.dashboard,
      tracing: !!toolbarConfig?.tracing,
      process: collectorNames.has('process'),
      system: collectorNames.has('system'),
      http: collectorNames.has('http'),
      db: collectorNames.has('db_pool'),
      redis: collectorNames.has('redis'),
      queues: collectorNames.has('queue'),
      cache: collectorNames.has('redis'),
      app: collectorNames.has('app'),
      log: collectorNames.has('log'),
      emails: !!toolbarConfig?.enabled,
    }

    // Custom panes from config
    const customPanes = toolbarConfig?.panes ?? []

    // Endpoint paths
    const debugEndpoint = toolbarConfig?.debugEndpoint ?? '/admin/api/debug'
    const dashboardPath = toolbarConfig?.dashboardPath ?? '/__stats'
    const statsEndpoint =
      typeof cfg?.endpoint === 'string' ? cfg.endpoint : '/admin/api/server-stats'

    const endpoints = {
      stats: statsEndpoint,
      debug: debugEndpoint,
      dashboard: dashboardPath,
    }

    // Transmit config
    const transmit = {
      channelName: cfg?.channelName ?? 'admin/server-stats',
    }

    return response.json({ features, customPanes, endpoints, transmit })
  }

  async diagnostics({ response }: HttpContext) {
    const engine = this.diagnosticsDeps.getEngine?.()
    const dashboardStore = this.diagnosticsDeps.getDashboardStore?.()
    const providerDiag = this.diagnosticsDeps.getProviderDiagnostics?.() ?? {}

    // Package version — read from disk since createRequire resolves from
    // the compiled output directory where ../../package.json doesn't exist.
    let packageVersion = 'unknown'
    try {
      const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
      const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8'))
      packageVersion = pkgJson.version
    } catch {
      // Fallback
    }

    // AdonisJS version
    let adonisVersion = 'unknown'
    try {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const adonisPkg = require('@adonisjs/core/package.json')
      adonisVersion = adonisPkg.version
    } catch {
      // Not installed or not resolvable
    }

    // Collector health + configs
    const healthList = engine?.getCollectorHealth() ?? []
    const configList = engine?.getCollectorConfigs() ?? []
    const configMap = new Map(configList.map((c) => [c.name, c.config]))

    const collectors = healthList.map((h) => ({
      ...h,
      config: configMap.get(h.name) ?? {},
    }))

    // Buffer stats
    const buffers = this.store.getBufferStats()

    // Storage stats (if dashboard is active)
    let storage = null
    if (dashboardStore) {
      try {
        storage = await dashboardStore.getStorageStats()
      } catch {
        // Dashboard store not ready
      }
    }

    return response.json({
      package: {
        version: packageVersion,
        nodeVersion: process.version,
        adonisVersion,
        uptime: process.uptime(),
      },
      ...providerDiag,
      collectors,
      buffers,
      storage,
    })
  }
}

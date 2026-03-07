import { log } from '../utils/logger.js'

import type { MetricCollector } from '../collectors/collector.js'
import type { MetricValue } from '../types.js'

/**
 * Health status for an individual collector.
 */
export interface CollectorHealth {
  name: string
  label: string
  status: 'healthy' | 'errored' | 'stopped'
  lastError: string | null
  lastErrorAt: number | null
}

/**
 * Central orchestrator that runs all configured collectors in parallel
 * and merges their results into a single flat record.
 *
 * The provider creates one `StatsEngine` instance at app boot, binds
 * it to the container as `'server_stats.engine'`, and runs
 * {@link collect} on a timer every `intervalMs` milliseconds.
 *
 * @example Accessing the engine from a controller
 * ```ts
 * const engine = await app.container.make('server_stats.engine') as StatsEngine
 * return response.json(engine.getLatestStats())
 * ```
 */
export class StatsEngine {
  private collectors: MetricCollector[]
  private latestStats: Record<string, MetricValue> = {}
  private collectorHealth: Map<string, CollectorHealth> = new Map()

  constructor(collectors: MetricCollector[]) {
    this.collectors = collectors

    for (const collector of collectors) {
      this.collectorHealth.set(collector.name, {
        name: collector.name,
        label: collector.label ?? collector.name,
        status: 'healthy',
        lastError: null,
        lastErrorAt: null,
      })
    }
  }

  /**
   * Initialize all collectors.
   *
   * Calls each collector's `start()` method (if defined) sequentially.
   * Called once by the provider during the `ready` phase.
   */
  async start(): Promise<void> {
    for (const collector of this.collectors) {
      await collector.start?.()
    }

    if (this.collectors.length > 0) {
      log.list(
        'collectors started:',
        this.collectors.map((c) => c.label ?? c.name)
      )
    }
  }

  /**
   * Shut down all collectors.
   *
   * Calls each collector's `stop()` method (if defined) sequentially.
   * Called by the provider during app shutdown.
   */
  async stop(): Promise<void> {
    for (const collector of this.collectors) {
      await collector.stop?.()
    }

    for (const health of this.collectorHealth.values()) {
      health.status = 'stopped'
    }
  }

  /**
   * Run all collectors in parallel, merge their results, and return
   * the combined stats snapshot.
   *
   * A `timestamp` field is automatically added. If any collector throws,
   * its error is caught and that collector's metrics are omitted from
   * the result.
   */
  async collect(): Promise<Record<string, MetricValue>> {
    const results = await Promise.all(
      this.collectors.map(async (collector) => {
        try {
          const result = await collector.collect()
          const health = this.collectorHealth.get(collector.name)
          if (health) {
            health.status = 'healthy'
          }
          return result
        } catch (err) {
          const health = this.collectorHealth.get(collector.name)
          if (health) {
            const wasHealthy = health.status !== 'errored'
            health.status = 'errored'
            health.lastError = (err as Error).message
            health.lastErrorAt = Date.now()
            if (wasHealthy) {
              log.warn(
                `collector "${collector.name}" threw during collect() — ${(err as Error).message}`
              )
            }
          }
          return {}
        }
      })
    )

    this.latestStats = Object.assign({}, ...results, { timestamp: Date.now() })
    return this.latestStats
  }

  /**
   * Returns the most recent stats snapshot from the last `collect()` call.
   *
   * Returns an empty object if `collect()` has not been called yet.
   */
  getLatestStats(): Record<string, MetricValue> {
    return this.latestStats
  }

  /** Returns health status for all collectors. */
  getCollectorHealth(): CollectorHealth[] {
    return Array.from(this.collectorHealth.values())
  }

  /** Returns collector-specific configuration for all collectors. */
  getCollectorConfigs(): Array<{ name: string; config: Record<string, unknown> }> {
    return this.collectors.map((collector) => ({
      name: collector.name,
      config: collector.getConfig?.() ?? {},
    }))
  }
}

import type { MetricValue } from '../types.js'

/**
 * Interface that all metric collectors must implement.
 *
 * A collector is responsible for gathering a specific set of metrics
 * (e.g. CPU, memory, HTTP stats) and returning them as a flat
 * key-value record. The {@link StatsEngine} runs all configured
 * collectors in parallel each tick and merges their results into
 * a single {@link ServerStats} snapshot.
 *
 * @example Creating a custom collector
 * ```ts
 * import type { MetricCollector } from 'adonisjs-server-stats/collectors'
 *
 * function diskCollector(): MetricCollector {
 *   return {
 *     name: 'disk',
 *     async collect() {
 *       const { availableSpace, totalSpace } = await getDiskInfo()
 *       return {
 *         diskAvailableGb: availableSpace / 1e9,
 *         diskTotalGb: totalSpace / 1e9,
 *         diskUsagePercent: ((totalSpace - availableSpace) / totalSpace) * 100,
 *       }
 *     },
 *   }
 * }
 * ```
 */
export interface MetricCollector {
  /**
   * Unique name identifying this collector.
   *
   * Used for logging and debugging. Built-in collectors use names
   * like `'process'`, `'http'`, `'redis'`, etc.
   */
  name: string

  /**
   * Short description shown in the startup log.
   *
   * Include key options so the developer can verify the collector
   * is configured correctly at a glance.
   *
   * @example `'http — buffer: 10k, window: 60s'`
   */
  label?: string

  /**
   * Called once when the {@link StatsEngine} starts.
   *
   * Use this to initialize resources (e.g. start monitoring the
   * event loop, open file handles, connect to external services).
   */
  start?(): void | Promise<void>

  /**
   * Called once when the {@link StatsEngine} stops (during app shutdown).
   *
   * Use this to clean up resources (e.g. close connections, clear timers).
   */
  stop?(): void | Promise<void>

  /**
   * Collect metrics and return them as a flat key-value record.
   *
   * Called every tick (default: every 3 seconds). The engine calls
   * all collectors in parallel via `Promise.all`, so this method
   * should be as fast as possible.
   *
   * If the collector throws, the engine catches the error and
   * proceeds with the remaining collectors (the failing collector's
   * metrics will be missing from that tick).
   *
   * @returns A flat record of metric values. Keys should be unique
   *   across all collectors to avoid collisions when merged.
   */
  collect(): Record<string, MetricValue> | Promise<Record<string, MetricValue>>
}

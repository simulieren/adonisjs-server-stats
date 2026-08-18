import { resolveFromAppImport } from '../dashboard/integrations/adonisjs_queue_store.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'
import type { QueueStoreReader } from '../dashboard/integrations/adonisjs_queue_store.js'

/**
 * Options for {@link adonisQueueCollector}.
 */
export interface AdonisQueueCollectorOptions {
  // Reserved for future config (e.g. connection name overrides).
  // Currently all config is auto-detected via resolveFromAppImport.
}

/** Default metrics returned when queue data is unavailable. */
const QUEUE_DEFAULTS = {
  queueActive: 0,
  queueWaiting: 0,
  queueDelayed: 0,
  queueFailed: 0,
  queueWorkerCount: 0,
}

/** Internal deps seam — NOT part of the public API; for unit tests only. */
interface AdonisQueueCollectorDeps {
  resolveReader?: () => Promise<QueueStoreReader | null>
}

/**
 * Monitors an @adonisjs/queue job queue for active, waiting, delayed, and failed jobs.
 *
 * Auto-detects the driver (database or redis) from the host app's queue config.
 * Returns zeros if @adonisjs/queue is unavailable or the store cannot be reached.
 *
 * **Peer dependencies:** `@adonisjs/queue`
 */
export function adonisQueueCollector(
  _opts?: AdonisQueueCollectorOptions,
  deps?: AdonisQueueCollectorDeps
): MetricCollector {
  let warnedNotInstalled = false

  return {
    name: 'queue',
    label: 'queue — @adonisjs/queue (auto-detected driver)',

    getConfig() {
      return {
        driver: 'auto',
        source: '@adonisjs/queue',
      }
    },

    async collect() {
      try {
        const resolve = deps?.resolveReader ?? resolveFromAppImport
        const reader = await resolve()

        if (!reader) {
          if (!warnedNotInstalled) {
            warnedNotInstalled = true
            log.block(
              `Queue collector ${bold('skipped')} — @adonisjs/queue is not installed or not reachable`,
              [
                dim('Queue metrics will return zeros until the package is available.'),
                `Run ${bold('node ace add @adonisjs/queue')} to install it.`,
              ]
            )
          }
          return QUEUE_DEFAULTS
        }

        const [counts, workerCount] = await Promise.all([
          reader.getCounts(),
          reader.getWorkerCount(),
        ])

        return {
          queueActive: counts.active,
          queueWaiting: counts.waiting,
          queueDelayed: counts.delayed,
          queueFailed: counts.failed,
          queueWorkerCount: workerCount,
        }
      } catch {
        return QUEUE_DEFAULTS
      }
    },
  }
}

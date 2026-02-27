import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

/**
 * Options for {@link dbPoolCollector}.
 */
export interface DbPoolCollectorOptions {
  /**
   * Lucid database connection name to monitor.
   *
   * Must match a key in your `config/database.ts` connections object.
   *
   * @default 'postgres'
   */
  connectionName?: string
}

/**
 * Monitors the Knex connection pool for a Lucid database connection.
 *
 * **Metrics produced:**
 * - `dbPoolUsed` -- connections currently checked out
 * - `dbPoolFree` -- idle connections available
 * - `dbPoolPending` -- queries waiting for a connection
 * - `dbPoolMax` -- maximum pool size
 *
 * Returns zeros if the connection or pool is unavailable.
 *
 * **Peer dependencies:** `@adonisjs/lucid`
 *
 * @example
 * ```ts
 * import { dbPoolCollector } from 'adonisjs-server-stats/collectors'
 *
 * dbPoolCollector()                                // monitor 'postgres'
 * dbPoolCollector({ connectionName: 'mysql' })     // monitor 'mysql'
 * ```
 */
export function dbPoolCollector(opts?: DbPoolCollectorOptions): MetricCollector {
  const connectionName = opts?.connectionName ?? 'postgres'

  let warnedLucidMissing = false
  let warnedConnectionNotFound = false
  let warnedPoolUnavailable = false

  return {
    name: 'db_pool',
    label: `db_pool — connection: ${connectionName}`,

    async collect() {
      try {
        const { default: db } = await import('@adonisjs/lucid/services/db')
        const connection = db.manager.get(connectionName)
        if (!connection) {
          if (!warnedConnectionNotFound) {
            warnedConnectionNotFound = true
            log.block(`db_pool: connection ${bold(connectionName)} not found in db.manager`, [
              dim('The name must match a key in your') +
                ` ${bold('config/database.ts')} ` +
                dim('connections object.'),
              dim('Available connections are registered at app boot — double-check spelling.'),
            ])
          }
          return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
        }
        const pool = (connection.connection as any)?.pool
        if (!pool) {
          if (!warnedPoolUnavailable) {
            warnedPoolUnavailable = true
            log.block(`db_pool: pool not available on connection ${bold(connectionName)}`, [
              dim('This usually means the connection has not been established yet,'),
              dim('or the database driver does not expose a Knex-style pool.'),
              dim('Pool metrics will report zeros until the pool is available.'),
            ])
          }
          return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
        }
        return {
          dbPoolUsed: pool.numUsed?.() ?? 0,
          dbPoolFree: pool.numFree?.() ?? 0,
          dbPoolPending: pool.numPendingAcquires?.() ?? 0,
          dbPoolMax: pool.max ?? 0,
        }
      } catch {
        if (!warnedLucidMissing) {
          warnedLucidMissing = true
          log.block(`db_pool: ${bold('@adonisjs/lucid')} is not installed or failed to import`, [
            dim('Install it with:'),
            `  ${bold('node ace add @adonisjs/lucid')}`,
            dim('Pool metrics will report zeros until the package is available.'),
          ])
        }
        return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
      }
    },
  }
}

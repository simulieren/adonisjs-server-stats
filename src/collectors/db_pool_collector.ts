import { appImport } from '../utils/app_import.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

/** Minimal interface for a Knex connection pool. */
export interface KnexPool {
  numUsed?(): number
  numFree?(): number
  numPendingAcquires?(): number
  max?: number
}

/** Default pool metrics returned when the pool is unavailable. */
const POOL_DEFAULTS = { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }

/** Extract pool stats from a Knex pool object, defaulting to 0. */
export function extractPoolMetrics(pool: Partial<KnexPool>) {
  return {
    dbPoolUsed: pool.numUsed?.() ?? 0,
    dbPoolFree: pool.numFree?.() ?? 0,
    dbPoolPending: pool.numPendingAcquires?.() ?? 0,
    dbPoolMax: pool.max ?? 0,
  }
}

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
 * **Peer dependencies:** `@adonisjs/lucid`
 */
export function dbPoolCollector(opts?: DbPoolCollectorOptions): MetricCollector {
  const connectionName = opts?.connectionName ?? 'postgres'

  let warnedLucidMissing = false
  let warnedConnectionNotFound = false
  let warnedPoolUnavailable = false

  return {
    name: 'db_pool',
    label: `db_pool — connection: ${connectionName}`,

    getConfig() {
      return { connectionName }
    },

    async collect() {
      try {
        return await collectPoolMetrics(connectionName, {
          warnConnectionNotFound(alreadyWarned) {
            if (!alreadyWarned) warnedConnectionNotFound = true
            return warnedConnectionNotFound
          },
          warnPoolUnavailable(alreadyWarned) {
            if (!alreadyWarned) warnedPoolUnavailable = true
            return warnedPoolUnavailable
          },
          isConnectionNotFoundWarned: () => warnedConnectionNotFound,
          isPoolUnavailableWarned: () => warnedPoolUnavailable,
        })
      } catch {
        warnLucidMissing(warnedLucidMissing)
        warnedLucidMissing = true
        return POOL_DEFAULTS
      }
    },
  }
}

async function collectPoolMetrics(
  connectionName: string,
  warns: {
    isConnectionNotFoundWarned: () => boolean
    isPoolUnavailableWarned: () => boolean
    warnConnectionNotFound: (already: boolean) => boolean
    warnPoolUnavailable: (already: boolean) => boolean
  }
) {
  const { default: db } = await appImport<typeof import('@adonisjs/lucid/services/db')>(
    '@adonisjs/lucid/services/db'
  )
  const connection = db.manager.get(connectionName)
  if (!connection) {
    warnConnectionNotFound(connectionName, warns.isConnectionNotFoundWarned())
    warns.warnConnectionNotFound(true)
    return POOL_DEFAULTS
  }
  const pool = (connection.connection as unknown as { pool?: KnexPool })?.pool
  if (!pool) {
    warnPoolUnavailable(connectionName, warns.isPoolUnavailableWarned())
    warns.warnPoolUnavailable(true)
    return POOL_DEFAULTS
  }
  return extractPoolMetrics(pool)
}

function warnConnectionNotFound(name: string, alreadyWarned: boolean): void {
  if (alreadyWarned) return
  log.block(`db_pool: connection ${bold(name)} not found in db.manager`, [
    dim('The name must match a key in your') +
      ` ${bold('config/database.ts')} ` +
      dim('connections object.'),
    dim('Available connections are registered at app boot — double-check spelling.'),
  ])
}

function warnPoolUnavailable(name: string, alreadyWarned: boolean): void {
  if (alreadyWarned) return
  log.block(`db_pool: pool not available on connection ${bold(name)}`, [
    dim('This usually means the connection has not been established yet,'),
    dim('or the database driver does not expose a Knex-style pool.'),
    dim('Pool metrics will report zeros until the pool is available.'),
  ])
}

function warnLucidMissing(alreadyWarned: boolean): void {
  if (alreadyWarned) return
  log.block(`db_pool: ${bold('@adonisjs/lucid')} is not installed or failed to import`, [
    dim('Install it with:'),
    `  ${bold('node ace add @adonisjs/lucid')}`,
    dim('Pool metrics will report zeros until the package is available.'),
  ])
}

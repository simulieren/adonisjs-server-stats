import type { MetricCollector } from './collector.js'

export interface DbPoolCollectorOptions {
  connectionName?: string
}

export function dbPoolCollector(opts?: DbPoolCollectorOptions): MetricCollector {
  const connectionName = opts?.connectionName ?? 'postgres'

  return {
    name: 'db_pool',

    async collect() {
      try {
        const { default: db } = await import('@adonisjs/lucid/services/db')
        const connection = db.manager.get(connectionName)
        if (!connection) {
          return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
        }
        const pool = (connection.connection as any)?.pool
        if (!pool) {
          return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
        }
        return {
          dbPoolUsed: pool.numUsed?.() ?? 0,
          dbPoolFree: pool.numFree?.() ?? 0,
          dbPoolPending: pool.numPendingAcquires?.() ?? 0,
          dbPoolMax: pool.max ?? 0,
        }
      } catch {
        return { dbPoolUsed: 0, dbPoolFree: 0, dbPoolPending: 0, dbPoolMax: 0 }
      }
    },
  }
}

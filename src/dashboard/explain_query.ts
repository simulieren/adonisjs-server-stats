/**
 * EXPLAIN query execution helper for the DashboardStore.
 *
 * Extracted from DashboardStore to reduce file length.
 */

import { CoalesceCache } from './coalesce_cache.js'

import type { Knex } from 'knex'

export function executeExplain(
  db: Knex,
  cache: CoalesceCache,
  queryId: number,
  appDb: unknown
): Promise<Record<string, unknown> | null> {
  return cache.coalesce('explain:' + queryId, async () => {
    const row = await db('server_stats_queries').where('id', queryId).first()
    if (!row) return { error: 'Query not found' }
    const sql = row.sql_text.trim()
    if (!sql.toLowerCase().startsWith('select'))
      return { error: 'EXPLAIN is only supported for SELECT queries' }
    try {
      const r = await (
        appDb as { rawQuery: (s: string) => Promise<{ rows?: unknown[] }> }
      ).rawQuery(`EXPLAIN ${sql}`)
      return { plan: r.rows || r }
    } catch (err) {
      return { error: (err as Error).message || 'EXPLAIN failed' }
    }
  })
}

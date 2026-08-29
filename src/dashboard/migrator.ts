import {
  yieldToEventLoop,
  migrateRequests,
  migrateQueries,
  migrateEvents,
  migrateEmails,
  migrateLogs,
  migrateTraces,
  migrateMetrics,
  migrateSavedFilters,
} from './migrator_tables.js'

import type { Knex } from 'knex'

/**
 * Auto-migrate all dashboard SQLite tables.
 *
 * Uses raw SQL (not Lucid migrations) so we never pollute the host
 * application's migration history.  Each `CREATE TABLE` / `CREATE INDEX`
 * uses `IF NOT EXISTS` so the function is idempotent.
 *
 * Yields to the event loop between each table so the server can
 * continue processing HTTP requests during migration.
 */
export async function autoMigrate(db: Knex): Promise<void> {
  await migrateRequests(db)
  await yieldToEventLoop()

  await migrateQueries(db)
  await yieldToEventLoop()

  await migrateEvents(db)
  await yieldToEventLoop()

  await migrateEmails(db)
  await yieldToEventLoop()

  await migrateLogs(db)
  await yieldToEventLoop()

  await migrateTraces(db)
  await yieldToEventLoop()

  await migrateMetrics(db)
  await yieldToEventLoop()

  await migrateSavedFilters(db)
}

/**
 * Delete records older than `retentionDays` from all tables.
 *
 * Foreign-key cascades on `server_stats_requests` handle the child
 * tables (queries, events, traces).  Standalone tables (logs, emails,
 * metrics, saved_filters) are pruned individually.
 *
 * Yields between each DELETE so the event loop stays responsive.
 */
export async function runRetentionCleanup(db: Knex, retentionDays: number): Promise<void> {
  // Use string interpolation instead of parameterized bindings.
  // Knex + better-sqlite3 can hang on parameterized db.raw() calls,
  // while non-parameterized queries (used in migrations) work fine.
  // Safe here — retentionDays is always a controlled integer.
  const days = Math.max(1, Math.floor(retentionDays))
  const cutoff = `datetime('now', '-${days} days')`

  try {
    // Cascade deletes queries, events, traces via FK ON DELETE CASCADE
    await batchDelete(db, 'server_stats_requests', cutoff)
    await yieldToEventLoop()

    // Standalone tables
    await batchDelete(db, 'server_stats_logs', cutoff)
    await yieldToEventLoop()

    await batchDelete(db, 'server_stats_emails', cutoff)
    await yieldToEventLoop()

    await batchDelete(db, 'server_stats_metrics', cutoff)
    await yieldToEventLoop()

    // Return deleted pages to the OS — PRAGMA optimize alone only updates
    // planner stats, leaving the file at its high-water mark forever.
    await reclaimFreeSpace(db)

    // Update query planner statistics
    await db.raw('PRAGMA optimize')
  } catch (err) {
    // Log but don't throw — retention cleanup failure shouldn't block init
    const { log } = await import('../utils/logger.js')
    log.warn(`dashboard: retention cleanup error — ${(err as Error)?.message}`)
  }
}

/**
 * Batch-delete old rows from a table, yielding between batches.
 *
 * Each batch deletes up to 1000 rows to avoid blocking the event loop
 * for large tables.
 */
async function batchDelete(db: Knex, table: string, cutoff: string): Promise<void> {
  let hasMore = true
  while (hasMore) {
    await db.raw(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE created_at < ${cutoff} LIMIT 1000)`
    )
    // changes() reports the last DELETE's row count on this connection
    // (pool is min:1/max:1). Re-counting the remaining backlog here instead
    // made total work quadratic in backlog size.
    const deleted = await pragmaNumber(db, 'SELECT changes() AS n')
    hasMore = deleted === 1000
    if (hasMore) await yieldToEventLoop()
  }
}

/**
 * Return freelist pages to the OS after a cleanup pass.
 *
 * Databases created with `auto_vacuum=INCREMENTAL` are trimmed in bounded
 * chunks so each synchronous step stays short. Legacy databases (created
 * before the pragma existed) can't be trimmed incrementally, so when dead
 * pages exceed ~30% of the file a one-time VACUUM rewrites it — which also
 * converts it to incremental mode, since `auto_vacuum=INCREMENTAL` is set
 * on this connection.
 */
async function reclaimFreeSpace(db: Knex): Promise<void> {
  const mode = await pragmaNumber(db, 'PRAGMA auto_vacuum')

  if (mode === 2) {
    // Chunks of ~2000 pages (~8 MB at the 4 KB default) keep each synchronous
    // call short; guard bounds one pass at ~8 GB in case freelist_count
    // misbehaves.
    let guard = 1000
    while (guard-- > 0) {
      const freelist = await pragmaNumber(db, 'PRAGMA freelist_count')
      if (freelist <= 0) break
      if (!(await incrementalVacuumChunk(db))) break
      await yieldToEventLoop()
    }
    return
  }

  const pageCount = await pragmaNumber(db, 'PRAGMA page_count')
  const freelistCount = await pragmaNumber(db, 'PRAGMA freelist_count')
  if (pageCount > 0 && freelistCount / pageCount > 0.3) {
    const { log } = await import('../utils/logger.js')
    log.info(
      `dashboard: reclaiming ${freelistCount} of ${pageCount} pages via one-time VACUUM (may pause briefly)`
    )
    await db.raw('VACUUM')
    log.info('dashboard: VACUUM complete — database converted to incremental auto-vacuum')
  }
}

/**
 * Free up to 2000 freelist pages. incremental_vacuum frees ONE page per
 * sqlite3_step, and knex's raw() steps no-result pragmas exactly once — so
 * it must run on the underlying better-sqlite3 handle, whose .pragma()
 * steps to completion. Returns false if the handle has no pragma method.
 */
async function incrementalVacuumChunk(db: Knex): Promise<boolean> {
  const client = db.client as unknown as {
    acquireConnection: () => Promise<unknown>
    releaseConnection: (conn: unknown) => void
  }
  const conn = (await client.acquireConnection()) as { pragma?: (stmt: string) => unknown }
  try {
    if (typeof conn.pragma !== 'function') return false
    conn.pragma('incremental_vacuum(2000)')
    return true
  } finally {
    client.releaseConnection(conn)
  }
}

/** Run a single-row/single-column statement and return its value as a number. */
async function pragmaNumber(db: Knex, statement: string): Promise<number> {
  const rows = (await db.raw(statement)) as unknown as Array<Record<string, unknown>>
  const value = Object.values(rows?.[0] ?? {})[0]
  return Number(value ?? 0)
}

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

    // Reclaim space and update query planner statistics
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
    const remaining = await db.raw(
      `SELECT COUNT(*) as cnt FROM ${table} WHERE created_at < ${cutoff} LIMIT 1`
    )
    const cnt = (remaining as unknown as Array<{ cnt: number }>)?.[0]?.cnt ?? 0
    hasMore = cnt > 0
    if (hasMore) await yieldToEventLoop()
  }
}

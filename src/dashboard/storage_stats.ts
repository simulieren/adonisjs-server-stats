/**
 * Storage statistics queries for the dashboard diagnostics endpoint.
 */

import { stat as fsStat } from 'node:fs/promises'

import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// File size helpers
// ---------------------------------------------------------------------------

/**
 * Get the file sizes of the SQLite database and its WAL file.
 */
export async function getFileSizes(dbFilePath: string): Promise<[number, number]> {
  let fileSizeMb = 0
  let walSizeMb = 0
  try {
    const s = await fsStat(dbFilePath)
    fileSizeMb = Math.round((s.size / (1024 * 1024)) * 100) / 100
  } catch {
    // File may not exist yet
  }
  try {
    const ws = await fsStat(dbFilePath + '-wal')
    walSizeMb = Math.round((ws.size / (1024 * 1024)) * 100) / 100
  } catch {
    // WAL file may not exist
  }
  return [fileSizeMb, walSizeMb]
}

// ---------------------------------------------------------------------------
// Table row counts
// ---------------------------------------------------------------------------

const TABLE_NAMES = [
  'server_stats_requests',
  'server_stats_queries',
  'server_stats_events',
  'server_stats_emails',
  'server_stats_logs',
  'server_stats_traces',
  'server_stats_metrics',
  'server_stats_saved_filters',
]

/**
 * Count rows in all dashboard tables within a single transaction.
 */
export async function countAllTables(
  db: Knex
): Promise<Array<{ name: string; rowCount: number }>> {
  return db.transaction(async (trx) => {
    const result: Array<{ name: string; rowCount: number }> = []
    for (const name of TABLE_NAMES) {
      try {
        const [row] = await trx(name).count('* as count')
        result.push({ name, rowCount: Number(row.count) })
      } catch {
        result.push({ name, rowCount: 0 })
      }
    }
    return result
  })
}

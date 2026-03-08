/**
 * Storage statistics queries for the dashboard diagnostics endpoint.
 */

import { stat as fsStat } from 'node:fs/promises'

import { CoalesceCache } from './coalesce_cache.js'

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
export async function countAllTables(db: Knex): Promise<Array<{ name: string; rowCount: number }>> {
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

// ---------------------------------------------------------------------------
// Storage stats result type and query
// ---------------------------------------------------------------------------

export interface StorageStatsResult {
  ready: boolean
  dbPath: string
  fileSizeMb: number
  walSizeMb: number
  retentionDays: number
  tables: Array<{ name: string; rowCount: number }>
  lastCleanupAt: number | null
}

export interface StorageStatsOpts {
  db: Knex
  cache: CoalesceCache
  dbFilePath: string
  dbPath: string
  retentionDays: number
  lastCleanupAt: number | null
  onResult: (stats: StorageStatsResult) => void
}

/**
 * Build storage stats by querying file sizes and table row counts.
 */
export function fetchStorageStats(opts: StorageStatsOpts): Promise<StorageStatsResult> {
  const { db, cache, dbFilePath, dbPath, retentionDays, lastCleanupAt, onResult } = opts
  return cache.coalesce('storageStats', async () => {
    const [fileSizeMb, walSizeMb] = await getFileSizes(dbFilePath)
    const tables = await countAllTables(db)
    const stats: StorageStatsResult = {
      ready: true,
      dbPath,
      fileSizeMb,
      walSizeMb,
      retentionDays,
      tables,
      lastCleanupAt,
    }
    onResult(stats)
    return stats
  })
}

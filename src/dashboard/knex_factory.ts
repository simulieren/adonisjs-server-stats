/**
 * Knex/SQLite connection factory and PRAGMA configuration.
 *
 * Extracted from DashboardStore to reduce initKnex line count
 * and keep the main store file focused on business logic.
 */

import { log } from '../utils/logger.js'

import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// PRAGMA constants
// ---------------------------------------------------------------------------

export const SQLITE_PRAGMAS = [
  'journal_mode=WAL',
  'foreign_keys=ON',
  'synchronous=NORMAL',
  'cache_size=-64000',
  'mmap_size=268435456',
  'temp_store=MEMORY',
]

const PRAGMA_STATEMENTS_FOR_POOL = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
  'cache_size = -64000',
  'mmap_size = 268435456',
  'temp_store = MEMORY',
]

// ---------------------------------------------------------------------------
// PRAGMA application via db.raw()
// ---------------------------------------------------------------------------

/**
 * Apply all SQLite PRAGMAs via db.raw() calls.
 * This is the fallback if afterCreate didn't work.
 */
export async function applyPragmas(db: Knex): Promise<void> {
  log.info('dashboard: setting PRAGMA...')
  for (const pragma of SQLITE_PRAGMAS) {
    await db.raw(`PRAGMA ${pragma}`)
  }
  log.info('dashboard: PRAGMA set')
}

// ---------------------------------------------------------------------------
// Knex connection creation
// ---------------------------------------------------------------------------

/**
 * Import knex and better-sqlite3 from the host app, then create
 * a standalone Knex connection to SQLite.
 */
export async function createKnexConnection(dbFilePath: string): Promise<Knex> {
  log.info('dashboard: loading knex...')
  const { appImportWithPath } = await import('../utils/app_import.js')

  const { module: knexModule, resolvedPath: knexPath } = await importWithError(
    appImportWithPath,
    'knex',
    'Install it with: npm install knex better-sqlite3'
  )

  const { resolvedPath: sqlite3Path } = await importWithError(
    appImportWithPath,
    'better-sqlite3',
    'Install it with: npm install better-sqlite3'
  )

  log.info(`dashboard: knex resolved from ${knexPath}`)
  log.info(`dashboard: better-sqlite3 resolved from ${sqlite3Path}`)

  const knexFactory = (knexModule as Record<string, unknown>).default ?? knexModule
  log.info(`dashboard: opening SQLite database at ${dbFilePath}`)

  return (knexFactory as Function)({
    client: 'better-sqlite3',
    connection: { filename: dbFilePath },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      acquireTimeoutMillis: 10_000,
      afterCreate: afterCreateHandler,
    },
  }) as Knex
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function importWithError(
  appImportWithPath: (mod: string) => Promise<{ module: unknown; resolvedPath: string }>,
  moduleName: string,
  installHint: string
): Promise<{ module: unknown; resolvedPath: string }> {
  try {
    return await appImportWithPath(moduleName)
  } catch (err) {
    throw new Error(
      `Could not load ${moduleName}: ${(err as Error)?.message}. ${installHint}`
    )
  }
}

function afterCreateHandler(
  conn: unknown,
  done: (err: Error | null, conn: unknown) => void
): void {
  const raw = conn as { pragma: (stmt: string) => void }
  try {
    for (const pragma of PRAGMA_STATEMENTS_FOR_POOL) {
      raw.pragma(pragma)
    }
  } catch {
    // Fallback: PRAGMAs will be set via db.raw() below
  }
  done(null, conn)
}

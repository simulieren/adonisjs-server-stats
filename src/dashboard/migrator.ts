import type { Knex } from 'knex'

/**
 * Auto-migrate all dashboard SQLite tables.
 *
 * Uses raw SQL (not Lucid migrations) so we never pollute the host
 * application's migration history.  Each `CREATE TABLE` / `CREATE INDEX`
 * uses `IF NOT EXISTS` so the function is idempotent.
 */
export async function autoMigrate(db: Knex): Promise<void> {
  // -- server_stats_requests --------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      duration REAL NOT NULL,
      span_count INTEGER DEFAULT 0,
      warning_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_requests_created ON server_stats_requests(created_at)`)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_requests_url ON server_stats_requests(url)`)

  // -- server_stats_queries ---------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
      sql_text TEXT NOT NULL,
      sql_normalized TEXT NOT NULL,
      bindings TEXT,
      duration REAL NOT NULL,
      method TEXT,
      model TEXT,
      connection TEXT,
      in_transaction INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_queries_created ON server_stats_queries(created_at)`)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_queries_normalized ON server_stats_queries(sql_normalized)`)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_queries_request ON server_stats_queries(request_id)`)

  // -- server_stats_events ----------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_events_created ON server_stats_events(created_at)`)

  // -- server_stats_emails ----------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      cc TEXT,
      bcc TEXT,
      subject TEXT NOT NULL,
      html TEXT,
      text_body TEXT,
      mailer TEXT NOT NULL,
      status TEXT NOT NULL,
      message_id TEXT,
      attachment_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_emails_created ON server_stats_emails(created_at)`)

  // -- server_stats_logs ------------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      request_id TEXT,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_logs_created ON server_stats_logs(created_at)`)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_logs_level ON server_stats_logs(level)`)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_logs_request ON server_stats_logs(request_id)`)

  // -- server_stats_traces ----------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      total_duration REAL NOT NULL,
      span_count INTEGER DEFAULT 0,
      spans TEXT NOT NULL,
      warnings TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_traces_created ON server_stats_traces(created_at)`)

  // -- server_stats_metrics ---------------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      request_count INTEGER DEFAULT 0,
      avg_duration REAL DEFAULT 0,
      p95_duration REAL DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      query_count INTEGER DEFAULT 0,
      avg_query_duration REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_metrics_bucket ON server_stats_metrics(bucket)`)

  // -- server_stats_saved_filters ---------------------------------------------
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      section TEXT NOT NULL,
      filter_config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

/**
 * Delete records older than `retentionDays` from all tables.
 *
 * Foreign-key cascades on `server_stats_requests` handle the child
 * tables (queries, events, traces).  Standalone tables (logs, emails,
 * metrics, saved_filters) are pruned individually.
 */
export async function runRetentionCleanup(db: Knex, retentionDays: number): Promise<void> {
  const modifier = `-${retentionDays} days`

  // Cascade deletes queries, events, traces via FK ON DELETE CASCADE
  await db.raw(`DELETE FROM server_stats_requests WHERE created_at < datetime('now', ?)`, [modifier])

  // Standalone tables
  await db.raw(`DELETE FROM server_stats_logs WHERE created_at < datetime('now', ?)`, [modifier])
  await db.raw(`DELETE FROM server_stats_emails WHERE created_at < datetime('now', ?)`, [modifier])
  await db.raw(`DELETE FROM server_stats_metrics WHERE created_at < datetime('now', ?)`, [modifier])
}

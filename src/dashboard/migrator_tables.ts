import type { Knex } from 'knex'

/**
 * Yield control back to the event loop so Node.js can process pending
 * I/O (incoming HTTP requests, timers, etc.).
 *
 * `better-sqlite3` is fully synchronous — when Knex wraps it, each
 * `await db.raw(...)` resolves via the microtask queue, never actually
 * yielding to the I/O phase. Without explicit yields, 25+ sequential
 * migration statements block the event loop for their entire duration.
 */
export const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

// ---------------------------------------------------------------------------
// Per-table migration functions
// ---------------------------------------------------------------------------

export async function migrateRequests(db: Knex): Promise<void> {
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      duration REAL NOT NULL,
      span_count INTEGER DEFAULT 0,
      warning_count INTEGER DEFAULT 0,
      http_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_requests_created ON server_stats_requests(created_at)`
  )
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_requests_url ON server_stats_requests(url)`)
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_requests_duration ON server_stats_requests(duration)`
  )
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_requests_status ON server_stats_requests(status_code)`
  )
  try {
    await db.raw('ALTER TABLE server_stats_requests ADD COLUMN http_request_id TEXT')
  } catch {}
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_requests_http_req ON server_stats_requests(http_request_id)`
  )
}

export async function migrateQueries(db: Knex): Promise<void> {
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
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_queries_created ON server_stats_queries(created_at)`
  )
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_queries_normalized ON server_stats_queries(sql_normalized)`
  )
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_queries_request ON server_stats_queries(request_id)`
  )
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_queries_duration ON server_stats_queries(duration)`
  )
}

export async function migrateEvents(db: Knex): Promise<void> {
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES server_stats_requests(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_events_created ON server_stats_events(created_at)`
  )
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_ss_events_name ON server_stats_events(event_name)`)
}

export async function migrateEmails(db: Knex): Promise<void> {
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
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_emails_created ON server_stats_emails(created_at)`
  )
}

export async function migrateLogs(db: Knex): Promise<void> {
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
}

export async function migrateTraces(db: Knex): Promise<void> {
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
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_traces_created ON server_stats_traces(created_at)`
  )
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_traces_request ON server_stats_traces(request_id)`
  )
}

export async function migrateMetrics(db: Knex): Promise<void> {
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
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_metrics_created ON server_stats_metrics(created_at)`
  )
}

export async function migrateSavedFilters(db: Knex): Promise<void> {
  await db.raw(`
    CREATE TABLE IF NOT EXISTS server_stats_saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      section TEXT NOT NULL,
      filter_config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  await db.raw(
    `CREATE INDEX IF NOT EXISTS idx_ss_filters_section ON server_stats_saved_filters(section)`
  )
}

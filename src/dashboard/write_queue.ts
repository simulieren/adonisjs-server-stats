/**
 * Data preparation helpers for the DashboardStore write queue.
 *
 * These functions transform in-memory records into SQLite-ready row
 * objects. They are pure (no I/O, no Knex dependency) so they can
 * be tested in isolation.
 */

import { round } from '../utils/math_helpers.js'
import { yieldToEventLoop } from './migrator_tables.js'
import { sanitizeBindings } from './sensitive_patterns.js'

import type { EventRecord, EmailRecord } from '../debug/types.js'
import type { PersistRequestInput } from './dashboard_types.js'
import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Warn-once tracking for write-path catch blocks
// ---------------------------------------------------------------------------
const warnedWritePaths = new Set<string>()

export function hasWarned(path: string): boolean {
  return warnedWritePaths.has(path)
}

export function markWarned(path: string): void {
  warnedWritePaths.add(path)
}

/**
 * Forget which write paths have warned. Called when a DashboardStore stops so
 * a re-initialized store in the same process warns afresh instead of
 * inheriting a spent latch from its predecessor.
 */
export function resetWriteWarnings(): void {
  warnedWritePaths.clear()
}

// ---------------------------------------------------------------------------
// SQL normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a SQL query by replacing literal values with `?` placeholders.
 * Used for grouping identical query patterns.
 *
 * Numeric replacement is restricted to value contexts (a digit run preceded
 * by whitespace, a comma, a paren, or an operator) so identifiers that contain
 * digits — e.g. `orders_2024` — are left intact and distinct queries are not
 * merged together.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')
    .replace(/(^|[\s,(=<>+\-*/])\d+(\.\d+)?\b/g, '$1?')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Binding hygiene — implementation lives in sensitive_patterns.ts so the
// in-memory QueryCollector can sanitize at capture time without importing the
// write path. Re-exported here for existing consumers.
// ---------------------------------------------------------------------------

export { sanitizeBindings }

// ---------------------------------------------------------------------------
// Prepared row types
// ---------------------------------------------------------------------------

export interface PreparedQuery {
  sql_text: string
  sql_normalized: string
  bindings: string | null
  duration: number
  method: string
  model: string | null
  connection: string
  in_transaction: number
}

export interface PreparedTraceRow {
  method: string
  url: string
  status_code: number
  total_duration: number
  span_count: number
  spans: string
  warnings: string | null
}

export interface PreparedRequest {
  input: PersistRequestInput
  filteredQueries: PreparedQuery[]
  traceRow: PreparedTraceRow | null
  eventRows: EventRow[]
}

export interface PreparedLog {
  [key: string]: unknown
  level: string
  message: string
  request_id: string | null
  data: string
}

export interface EmailRow {
  [key: string]: unknown
  from_addr: string
  to_addr: string
  cc: string | null
  bcc: string | null
  subject: string
  html: string | null
  text_body: string | null
  mailer: string
  status: string
  message_id: string | null
  attachment_count: number
}

export interface EventRow {
  [key: string]: unknown
  event_name: string
  data: string | null
}

// ---------------------------------------------------------------------------
// Pure data-prep functions
// ---------------------------------------------------------------------------

/**
 * Pre-stringify and transform request inputs into SQLite-ready row objects.
 * This is done OUTSIDE the transaction so the synchronous better-sqlite3
 * execution does not block the event loop on large spans.
 */
export function prepareRequestRows(requests: PersistRequestInput[]): PreparedRequest[] {
  return requests.map((input) => ({
    input,
    filteredQueries: input.queries
      .filter((q) => q.connection !== 'server_stats')
      .map((q) => ({
        sql_text: q.sql,
        sql_normalized: normalizeSql(q.sql),
        bindings: q.bindings ? JSON.stringify(sanitizeBindings(q.bindings, q.sql)) : null,
        duration: round(q.duration),
        method: q.method,
        model: q.model,
        connection: q.connection,
        in_transaction: q.inTransaction ? 1 : 0,
      })),
    eventRows: buildEventRows(input.events ?? []),
    traceRow: input.trace
      ? {
          method: input.trace.method,
          url: input.trace.url,
          status_code: input.trace.statusCode,
          total_duration: round(input.trace.totalDuration),
          span_count: input.trace.spanCount,
          spans: JSON.stringify(input.trace.spans),
          warnings: input.trace.warnings.length > 0 ? JSON.stringify(input.trace.warnings) : null,
        }
      : null,
  }))
}

/**
 * Transform raw log entries into SQLite-ready row objects.
 */
export function prepareLogRows(logs: Record<string, unknown>[]): PreparedLog[] {
  return logs.map((entry) => {
    const levelName =
      typeof entry.levelName === 'string' ? entry.levelName : String(entry.level || 'unknown')
    return {
      level: levelName,
      message: String(entry.msg || entry.message || ''),
      request_id:
        entry.request_id || entry.requestId || entry['x-request-id']
          ? String(entry.request_id || entry.requestId || entry['x-request-id'])
          : null,
      data: JSON.stringify(entry),
    }
  })
}

/**
 * Transform an EmailRecord into a SQLite-ready row object.
 */
export function buildEmailRow(record: EmailRecord): EmailRow {
  return {
    from_addr: record.from,
    to_addr: record.to,
    cc: record.cc,
    bcc: record.bcc,
    subject: record.subject,
    html: record.html,
    text_body: record.text,
    mailer: record.mailer,
    status: record.status,
    message_id: record.messageId,
    attachment_count: record.attachmentCount,
  }
}

/**
 * Transform EventRecords into SQLite-ready row objects.
 */
/**
 * Build event rows. `request_id` is attached at insert time, once the owning
 * request row has an id — leaving it null here (as this did previously) meant
 * retention never reclaimed them, since events are only pruned via the
 * `server_stats_requests` foreign-key cascade.
 */
export function buildEventRows(events: EventRecord[]): EventRow[] {
  return events.map((e) => ({
    event_name: e.event,
    data: e.data,
  }))
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

/**
 * Insert rows into a table in batches of 50.
 *
 * Yields to the event loop between chunks: better-sqlite3 is fully
 * synchronous, so without a real macrotask hop a large batch would execute
 * back-to-back on microtask continuations and stall the host app — the exact
 * failure mode `migrator_tables.ts` documents and guards against.
 */
export async function batchInsert(
  trx: Knex.Transaction,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += 50) {
    if (i > 0) await yieldToEventLoop()
    await trx(table).insert(rows.slice(i, i + 50))
  }
}

// ---------------------------------------------------------------------------
// Transaction sub-routines for flushWriteQueue
// ---------------------------------------------------------------------------

/**
 * Flush prepared requests (with queries + traces) into the database.
 */
/** Build the request row object for insertion. */
function buildRequestRow(input: PersistRequestInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    method: input.method,
    url: input.url,
    status_code: input.statusCode,
    duration: round(input.duration),
    span_count: input.trace?.spanCount ?? 0,
    warning_count: input.trace?.warnings?.length ?? 0,
  }
  if (input.httpRequestId) {
    row.http_request_id = String(input.httpRequestId)
  }
  return row
}

/** Insert a single prepared request with its queries and trace. */
async function insertOneRequest(trx: Knex.Transaction, prepared: PreparedRequest): Promise<void> {
  const { input, filteredQueries, traceRow, eventRows } = prepared
  const row = buildRequestRow(input)
  const [requestId] = await trx('server_stats_requests').insert(row)

  const hasId = requestId !== null && requestId !== undefined
  if (hasId && filteredQueries.length > 0) {
    const rows = filteredQueries.map((q) => ({ ...q, request_id: requestId }))
    await batchInsert(trx, 'server_stats_queries', rows)
  }
  if (hasId && eventRows.length > 0) {
    const rows = eventRows.map((e) => ({ ...e, request_id: requestId }))
    await batchInsert(trx, 'server_stats_events', rows)
  }
  if (hasId && traceRow) {
    await trx('server_stats_traces').insert({ ...traceRow, request_id: requestId })
  }
}

export async function flushRequests(
  trx: Knex.Transaction,
  preparedRequests: PreparedRequest[]
): Promise<void> {
  let sinceYield = 0
  for (const prepared of preparedRequests) {
    // Up to ~4 synchronous statements per request; a full backlog is hundreds
    // of them in one flush. Yield periodically so the host app's I/O keeps
    // being serviced mid-flush (see batchInsert for why awaits alone don't).
    if (++sinceYield >= 10) {
      sinceYield = 0
      await yieldToEventLoop()
    }
    try {
      await insertOneRequest(trx, prepared)
    } catch (err) {
      if (!hasWarned('persistRequest')) {
        markWarned('persistRequest')
        const { log } = await import('../utils/logger.js')
        log.warn(`dashboard: persistRequest failed — ${(err as Error)?.message}`)
      }
    }
  }
}

/**
 * Flush pending emails into the database.
 */
export async function flushEmails(trx: Knex.Transaction, emails: EmailRecord[]): Promise<void> {
  if (emails.length === 0) return
  try {
    const rows = emails.map((record) => buildEmailRow(record))
    await batchInsert(trx, 'server_stats_emails', rows)
  } catch (err) {
    if (!hasWarned('recordEmail')) {
      markWarned('recordEmail')
      const { log } = await import('../utils/logger.js')
      log.warn(`dashboard: recordEmail failed — ${(err as Error)?.message}`)
    }
  }
}

/**
 * Flush prepared logs into the database.
 */
export async function flushLogs(trx: Knex.Transaction, preparedLogs: PreparedLog[]): Promise<void> {
  if (preparedLogs.length === 0) return
  try {
    await batchInsert(trx, 'server_stats_logs', preparedLogs)
  } catch (err) {
    if (!hasWarned('recordLog')) {
      markWarned('recordLog')
      const { log } = await import('../utils/logger.js')
      log.warn(`dashboard: recordLog failed — ${(err as Error)?.message}`)
    }
  }
}

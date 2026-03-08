/**
 * Data preparation helpers for the DashboardStore write queue.
 *
 * These functions transform in-memory records into SQLite-ready row
 * objects. They are pure (no I/O, no Knex dependency) so they can
 * be tested in isolation.
 */

import { round } from '../utils/math_helpers.js'

import type { PersistRequestInput } from './dashboard_types.js'
import type { EventRecord, EmailRecord } from '../debug/types.js'
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

// ---------------------------------------------------------------------------
// SQL normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a SQL query by replacing literal values with `?` placeholders.
 * Used for grouping identical query patterns.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
}

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
}

export interface PreparedLog {
  level: string
  message: string
  request_id: string | null
  data: string
}

export interface EmailRow {
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
  request_id: null
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
        bindings: q.bindings ? JSON.stringify(q.bindings) : null,
        duration: round(q.duration),
        method: q.method,
        model: q.model,
        connection: q.connection,
        in_transaction: q.inTransaction ? 1 : 0,
      })),
    traceRow: input.trace
      ? {
          method: input.trace.method,
          url: input.trace.url,
          status_code: input.trace.statusCode,
          total_duration: round(input.trace.totalDuration),
          span_count: input.trace.spanCount,
          spans: JSON.stringify(input.trace.spans),
          warnings:
            input.trace.warnings.length > 0
              ? JSON.stringify(input.trace.warnings)
              : null,
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
      typeof entry.levelName === 'string'
        ? entry.levelName
        : String(entry.level || 'unknown')
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
export function buildEventRows(events: EventRecord[]): EventRow[] {
  return events.map((e) => ({
    request_id: null,
    event_name: e.event,
    data: e.data,
  }))
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

/**
 * Insert rows into a table in batches of 50.
 */
export async function batchInsert(
  trx: Knex.Transaction,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += 50) {
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
async function insertOneRequest(
  trx: Knex.Transaction,
  prepared: PreparedRequest
): Promise<void> {
  const { input, filteredQueries, traceRow } = prepared
  const row = buildRequestRow(input)
  const [requestId] = await trx('server_stats_requests').insert(row)

  const hasId = requestId !== null && requestId !== undefined
  if (hasId && filteredQueries.length > 0) {
    const rows = filteredQueries.map((q) => ({ ...q, request_id: requestId }))
    await batchInsert(trx, 'server_stats_queries', rows)
  }
  if (hasId && traceRow) {
    await trx('server_stats_traces').insert({ ...traceRow, request_id: requestId })
  }
}

export async function flushRequests(
  trx: Knex.Transaction,
  preparedRequests: PreparedRequest[]
): Promise<void> {
  for (const prepared of preparedRequests) {
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
 * Flush pending events into the database.
 */
export async function flushEvents(
  trx: Knex.Transaction,
  events: { requestIndex: number; events: EventRecord[] }[]
): Promise<void> {
  for (const { events: evts } of events) {
    try {
      const rows = buildEventRows(evts)
      await batchInsert(trx, 'server_stats_events', rows)
    } catch (err) {
      if (!hasWarned('recordEvents')) {
        markWarned('recordEvents')
        const { log } = await import('../utils/logger.js')
        log.warn(`dashboard: recordEvents failed — ${(err as Error)?.message}`)
      }
    }
  }
}

/**
 * Flush pending emails into the database.
 */
export async function flushEmails(
  trx: Knex.Transaction,
  emails: EmailRecord[]
): Promise<void> {
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
export async function flushLogs(
  trx: Knex.Transaction,
  preparedLogs: PreparedLog[]
): Promise<void> {
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

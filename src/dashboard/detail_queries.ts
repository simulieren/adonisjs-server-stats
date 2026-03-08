/**
 * Detail queries for individual request and trace records.
 *
 * Extracted from DashboardStore to reduce file length.
 */

import { safeParseJson, safeParseJsonArray } from '../utils/json_helpers.js'

import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Log time-window fallback
// ---------------------------------------------------------------------------

/**
 * Query logs within a time window around a given timestamp.
 * Used as a fallback when no precise request_id correlation exists.
 */
export async function queryLogsByTimeWindow(
  db: Knex,
  createdAt: string,
  duration: number
): Promise<Record<string, unknown>[]> {
  const windowSec = Math.ceil(duration / 1000) + 2
  return db('server_stats_logs')
    .where('created_at', '>=', db.raw(`datetime(?, '-${windowSec} seconds')`, [createdAt]))
    .where('created_at', '<=', db.raw(`datetime(?, '+${windowSec} seconds')`, [createdAt]))
    .orderBy('created_at', 'asc')
    .limit(100)
}

// ---------------------------------------------------------------------------
// Trace detail
// ---------------------------------------------------------------------------

/**
 * Fetch a single trace with full span data and correlated logs.
 */
export async function fetchTraceDetail(
  db: Knex,
  id: number
): Promise<Record<string, unknown> | null> {
  const row = await db('server_stats_traces').where('id', id).first()
  if (!row) return null

  let logs: Record<string, unknown>[] = []
  let httpRequestId: string | null = null

  if (row.request_id) {
    const linkedRequest = await db('server_stats_requests')
      .where('id', row.request_id)
      .select('http_request_id', 'created_at')
      .first()
    if (linkedRequest?.http_request_id) {
      httpRequestId = linkedRequest.http_request_id
      logs = await db('server_stats_logs')
        .where('request_id', linkedRequest.http_request_id)
        .orderBy('created_at', 'asc')
    }
  }

  if (logs.length === 0 && row.created_at) {
    logs = await queryLogsByTimeWindow(db, row.created_at, row.total_duration || 0)
  }

  return {
    ...row,
    spans: safeParseJson(row.spans) ?? [],
    warnings: safeParseJsonArray(row.warnings),
    logs,
    http_request_id: httpRequestId,
  }
}

// ---------------------------------------------------------------------------
// Request detail
// ---------------------------------------------------------------------------

/**
 * Fetch a single request with associated queries, events, trace, and logs.
 */
export async function fetchRequestDetail(
  db: Knex,
  id: number
): Promise<Record<string, unknown> | null> {
  return db.transaction(async (trx) => {
    const request = await trx('server_stats_requests').where('id', id).first()
    if (!request) return null

    const queries = await trx('server_stats_queries')
      .where('request_id', id)
      .orderBy('created_at', 'asc')
    const events = await trx('server_stats_events')
      .where('request_id', id)
      .orderBy('created_at', 'asc')
    const trace = await trx('server_stats_traces').where('request_id', id).first()

    let logs: Record<string, unknown>[] = []
    if (request.http_request_id) {
      logs = await trx('server_stats_logs')
        .where('request_id', request.http_request_id)
        .orderBy('created_at', 'asc')
    }

    if (logs.length === 0 && request.created_at) {
      logs = await queryLogsByTimeWindow(
        trx as unknown as Knex,
        request.created_at,
        request.duration || 0
      )
    }

    return {
      ...request,
      queries,
      events,
      logs,
      trace: trace
        ? {
            ...trace,
            spans: safeParseJson(trace.spans) ?? [],
            warnings: safeParseJsonArray(trace.warnings),
          }
        : null,
    }
  })
}

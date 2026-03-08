/**
 * Filter application functions for paginated dashboard queries.
 *
 * Each `apply*Filters` function takes a Knex QueryBuilder and an
 * optional filter object, adding WHERE clauses as needed.
 * Extracting these from DashboardStore reduces per-function complexity.
 */

import type { Knex } from 'knex'
import type {
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
} from './dashboard_types.js'

// ---------------------------------------------------------------------------
// Request filters
// ---------------------------------------------------------------------------

export function applyRequestFilters(
  query: Knex.QueryBuilder,
  filters: RequestFilters | undefined
): void {
  if (!filters) return
  if (filters.method) query.where('method', filters.method)
  if (filters.url) query.where('url', 'like', `%${filters.url}%`)
  if (filters.status) query.where('status_code', filters.status)
  if (filters.statusMin) query.where('status_code', '>=', filters.statusMin)
  if (filters.statusMax) query.where('status_code', '<=', filters.statusMax)
  if (filters.durationMin) query.where('duration', '>=', filters.durationMin)
  if (filters.durationMax) query.where('duration', '<=', filters.durationMax)
  if (filters.search) {
    const term = `%${filters.search}%`
    query.where((qb) => {
      qb.where('url', 'like', term).orWhere('method', 'like', term)
    })
  }
}

// ---------------------------------------------------------------------------
// Query filters
// ---------------------------------------------------------------------------

export function applyQueryFilters(
  query: Knex.QueryBuilder,
  filters: QueryFilters | undefined
): void {
  if (!filters) return
  if (filters.method) query.where('method', filters.method)
  if (filters.model) query.where('model', filters.model)
  if (filters.connection) query.where('connection', filters.connection)
  if (filters.durationMin) query.where('duration', '>=', filters.durationMin)
  if (filters.durationMax) query.where('duration', '<=', filters.durationMax)
  if (filters.requestId) query.where('request_id', filters.requestId)
  if (filters.search) {
    const term = `%${filters.search}%`
    query.where((qb) => {
      qb.where('sql_text', 'like', term)
        .orWhere('model', 'like', term)
        .orWhere('connection', 'like', term)
    })
  }
}

// ---------------------------------------------------------------------------
// Event filters
// ---------------------------------------------------------------------------

export function applyEventFilters(
  query: Knex.QueryBuilder,
  filters: EventFilters | undefined
): void {
  if (!filters) return
  if (filters.eventName) query.where('event_name', 'like', `%${filters.eventName}%`)
  if (filters.search) query.where('event_name', 'like', `%${filters.search}%`)
}

// ---------------------------------------------------------------------------
// Email filters
// ---------------------------------------------------------------------------

export function applyEmailFilters(
  query: Knex.QueryBuilder,
  filters: EmailFilters | undefined,
  excludeBody: boolean
): void {
  if (filters) {
    if (filters.search) {
      const term = `%${filters.search}%`
      query.where((sub) => {
        sub
          .where('from_addr', 'like', term)
          .orWhere('to_addr', 'like', term)
          .orWhere('subject', 'like', term)
      })
    }
    if (filters.from) query.where('from_addr', 'like', `%${filters.from}%`)
    if (filters.to) query.where('to_addr', 'like', `%${filters.to}%`)
    if (filters.subject) query.where('subject', 'like', `%${filters.subject}%`)
    if (filters.mailer) query.where('mailer', filters.mailer)
    if (filters.status) query.where('status', filters.status)
  }
  if (excludeBody) {
    query.select(
      'id',
      'from_addr',
      'to_addr',
      'cc',
      'bcc',
      'subject',
      'mailer',
      'status',
      'message_id',
      'attachment_count',
      'created_at'
    )
  }
}

// ---------------------------------------------------------------------------
// Log filters
// ---------------------------------------------------------------------------

/** Operator-to-SQL pattern lookup for structured log filters. */
const STRUCTURED_OPERATORS: Record<string, (value: string) => string> = {
  equals: (value) => value,
  contains: (value) => `%${value}%`,
  startsWith: (value) => `${value}%`,
}

/** Apply a single structured filter to a query. */
function applyStructuredFilter(
  query: Knex.QueryBuilder,
  sf: { field: string; operator: string; value: string }
): void {
  const patternFn = STRUCTURED_OPERATORS[sf.operator]
  if (!patternFn) return
  const jsonPath = `$.${sf.field}`
  const op = sf.operator === 'equals' ? '=' : 'LIKE'
  query.whereRaw(`json_extract(data, ?) ${op} ?`, [jsonPath, patternFn(sf.value)])
}

export function applyLogFilters(
  query: Knex.QueryBuilder,
  filters: LogFilters | undefined
): void {
  if (!filters) return
  if (filters.level) query.where('level', filters.level)
  if (filters.requestId) query.where('request_id', filters.requestId)
  if (filters.search) query.where('message', 'like', `%${filters.search}%`)
  if (filters.structured && filters.structured.length > 0) {
    for (const sf of filters.structured) {
      applyStructuredFilter(query, sf)
    }
  }
}

// ---------------------------------------------------------------------------
// Trace filters
// ---------------------------------------------------------------------------

export function applyTraceFilters(
  query: Knex.QueryBuilder,
  filters: TraceFilters | undefined
): void {
  if (!filters) return
  if (filters.method) query.where('method', filters.method)
  if (filters.url) query.where('url', 'like', `%${filters.url}%`)
  if (filters.statusMin) query.where('status_code', '>=', filters.statusMin)
  if (filters.statusMax) query.where('status_code', '<=', filters.statusMax)
  if (filters.search) {
    const term = `%${filters.search}%`
    query.where((qb) => {
      qb.where('url', 'like', term).orWhere('method', 'like', term)
    })
  }
}

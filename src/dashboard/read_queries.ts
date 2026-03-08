/**
 * Paginated and detail read queries for the DashboardStore.
 *
 * Extracted from DashboardStore to reduce file length.
 */

import { rangeToCutoff } from '../utils/time_helpers.js'
import { fetchTraceDetail, fetchRequestDetail } from './detail_queries.js'
import {
  applyRequestFilters,
  applyQueryFilters,
  applyEventFilters,
  applyEmailFilters,
  applyLogFilters,
  applyTraceFilters,
} from './filtered_queries.js'
import { executePaginate } from './paginate_helper.js'

import type { CoalesceCache } from './coalesce_cache.js'
import type {
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
  PaginatedResult,
} from './dashboard_types.js'
import type { Knex } from 'knex'

interface ReadCtx {
  db: Knex
  cache: CoalesceCache
}

const GROUPED_TTL = 3_000
const PAGINATE_TTL = 1_000

export function queryRequests(
  ctx: ReadCtx,
  page: number,
  perPage: number,
  filters?: RequestFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  return paginateCached(ctx, {
    table: 'server_stats_requests',
    page,
    perPage,
    applyFilters: (q) => applyRequestFilters(q, filters),
    filterKey: filters ? JSON.stringify(filters) : '',
  })
}

export function queryQueries(
  ctx: ReadCtx,
  page: number,
  perPage: number,
  filters?: QueryFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  return paginateCached(ctx, {
    table: 'server_stats_queries',
    page,
    perPage,
    applyFilters: (q) => applyQueryFilters(q, filters),
    filterKey: filters ? JSON.stringify(filters) : '',
  })
}

export function queryEvents(
  ctx: ReadCtx,
  page: number,
  perPage: number,
  filters?: EventFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  return paginateCached(ctx, {
    table: 'server_stats_events',
    page,
    perPage,
    applyFilters: (q) => applyEventFilters(q, filters),
    filterKey: filters ? JSON.stringify(filters) : '',
  })
}

export function queryEmails(
  ctx: ReadCtx,
  opts: { page: number; perPage: number; filters?: EmailFilters; excludeBody?: boolean }
): Promise<PaginatedResult<Record<string, unknown>>> {
  const { page, perPage, filters, excludeBody = false } = opts
  return paginateCached(ctx, {
    table: 'server_stats_emails',
    page,
    perPage,
    applyFilters: (q) => applyEmailFilters(q, filters, excludeBody),
    filterKey: (filters ? JSON.stringify(filters) : '') + (excludeBody ? ':noBody' : ''),
  })
}

export function queryLogs(
  ctx: ReadCtx,
  page: number,
  perPage: number,
  filters?: LogFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  return paginateCached(ctx, {
    table: 'server_stats_logs',
    page,
    perPage,
    applyFilters: (q) => applyLogFilters(q, filters),
    filterKey: filters ? JSON.stringify(filters) : '',
  })
}

export function queryTraces(
  ctx: ReadCtx,
  page: number,
  perPage: number,
  filters?: TraceFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  return paginateCached(ctx, {
    table: 'server_stats_traces',
    page,
    perPage,
    applyFilters: (q) => applyTraceFilters(q, filters),
    filterKey: filters ? JSON.stringify(filters) : '',
  })
}

export function queryQueriesGrouped(
  ctx: ReadCtx,
  opts: { limit: number; sort: string; search?: string }
): Promise<Record<string, unknown>[]> {
  const { db, cache } = ctx
  const { limit, sort, search } = opts
  return cache.cached(
    'queriesGrouped:' + limit + ':' + sort + ':' + (search || ''),
    GROUPED_TTL,
    async () => {
      const sorts: Record<string, string> = {
        count: 'count',
        avg_duration: 'avg_duration',
        total_duration: 'total_duration',
      }
      const cutoff = rangeToCutoff('7d')
      const q = db('server_stats_queries')
        .select(
          'sql_normalized',
          db.raw('COUNT(*) as count'),
          db.raw('ROUND(AVG(duration), 2) as avg_duration'),
          db.raw('ROUND(MIN(duration), 2) as min_duration'),
          db.raw('ROUND(MAX(duration), 2) as max_duration'),
          db.raw('ROUND(SUM(duration), 2) as total_duration')
        )
        .where('created_at', '>=', cutoff)
        .groupBy('sql_normalized')
        .orderBy(sorts[sort] || 'total_duration', 'desc')
        .limit(limit)
      if (search) q.where('sql_normalized', 'like', `%${search}%`)
      return q
    }
  )
}

export function queryEmailHtml(ctx: ReadCtx, id: number): Promise<string | null> {
  return ctx.cache.coalesce('emailHtml:' + id, async () => {
    const row = await ctx
      .db('server_stats_emails')
      .where('id', id)
      .select('html', 'text_body')
      .first()
    return row ? row.html || row.text_body || null : null
  })
}

export function queryTraceDetail(
  ctx: ReadCtx,
  id: number
): Promise<Record<string, unknown> | null> {
  return ctx.cache.coalesce('traceDetail:' + id, () => fetchTraceDetail(ctx.db, id))
}

export function queryRequestDetail(
  ctx: ReadCtx,
  id: number
): Promise<Record<string, unknown> | null> {
  return ctx.cache.coalesce('requestDetail:' + id, () => fetchRequestDetail(ctx.db, id))
}

function paginateCached(
  ctx: ReadCtx,
  opts: {
    table: string
    page: number
    perPage: number
    applyFilters?: (query: Knex.QueryBuilder) => void
    filterKey?: string
  }
): Promise<PaginatedResult<Record<string, unknown>>> {
  const key =
    'paginate:' + opts.table + ':' + opts.page + ':' + opts.perPage + ':' + (opts.filterKey || '')
  return ctx.cache.cached(key, PAGINATE_TTL, () => executePaginate(ctx.db, opts))
}

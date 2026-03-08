import { readFile, stat } from 'node:fs/promises'

import { parseAndEnrich } from '../log_stream/log_stream_service.js'

import type {
  DashboardStore,
  QueryFilters,
  EventFilters,
  EmailFilters,
  TraceFilters,
  LogFilters,
} from '../dashboard/dashboard_store.js'
import type { DebugStore } from '../debug/debug_store.js'
import type { QueryRecord, EventRecord, TraceRecord, RouteRecord } from '../debug/types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ListOptions {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  filters?: Record<string, unknown>

  /**
   * Force the data source for this read.
   *
   * - `'memory'` — always read from ring buffers ({@link DebugStore}).
   *   Use this for the debug panel, which expects camelCase field names
   *   matching the {@link QueryRecord}/{@link EventRecord}/etc. interfaces.
   * - `'auto'` (default) — use SQLite when available, fall back to memory.
   */
  source?: 'memory' | 'auto'
}

export interface PaginatedResult<T = Record<string, unknown>> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    lastPage: number
  }
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a plain array in the standard {@link PaginatedResult} envelope.
 *
 * Applies optional client-side search filtering and pagination so that
 * ring-buffer results match the same shape returned by the dashboard store.
 */
export function wrapArray<T>(
  items: T[],
  opts: ListOptions,
  searchFn?: (item: T, term: string) => boolean
): PaginatedResult<T> {
  let filtered = items

  // Client-side search
  if (opts.search && searchFn) {
    const term = opts.search.toLowerCase()
    filtered = filtered.filter((item) => searchFn(item, term))
  }

  const total = filtered.length
  const page = opts.page ?? 1
  // When perPage is not specified, return all items (backward compat for debug panel)
  const perPage = opts.perPage ?? (total || 1)
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  const start = (page - 1) * perPage
  const data = filtered.slice(start, start + perPage)

  return {
    data,
    meta: { total, page, perPage, lastPage },
  }
}

/**
 * Convert a flat {@link DashboardStore.PaginatedResult} to the nested
 * `{ data, meta }` shape used by the unified API.
 */
export function fromDashboardResult<T>(result: {
  data: T[]
  total: number
  page: number
  perPage: number
  lastPage: number
}): PaginatedResult<T> {
  return {
    data: result.data,
    meta: {
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      lastPage: result.lastPage,
    },
  }
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

export function mapTraceListRow<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    requestId: row.request_id ?? row.requestId,
    statusCode: row.status_code ?? row.statusCode,
    totalDuration: row.total_duration ?? row.totalDuration,
    spanCount: row.span_count ?? row.spanCount,
    createdAt: row.created_at ?? row.createdAt,
  }
}

/** Pick the first defined value from a row, trying snake_case then camelCase. */
function pick(
  row: Record<string, unknown>,
  snake: string,
  camel: string,
  fallback: unknown = null
) {
  return row[snake] ?? row[camel] ?? fallback
}

/** Normalize SQLite email column names to match the EmailRecord shape. */
export function normalizeEmailRow(row: Record<string, unknown>) {
  return {
    ...row,
    from: pick(row, 'from_addr', 'from', ''),
    to: pick(row, 'to_addr', 'to', ''),
    messageId: pick(row, 'message_id', 'messageId'),
    attachmentCount: pick(row, 'attachment_count', 'attachmentCount', 0),
    timestamp: pick(row, 'created_at', 'timestamp'),
  }
}

// ---------------------------------------------------------------------------
// Store delegate helpers
// ---------------------------------------------------------------------------

/** Build dashboard store query/event/email/trace pagination args. */
export function buildPaginationArgs(opts: ListOptions) {
  return {
    page: opts.page ?? 1,
    perPage: opts.perPage ?? 50,
  }
}

export function buildQueryFilters(opts: ListOptions): QueryFilters {
  return {
    search: opts.search,
    ...(opts.filters as Partial<QueryFilters>),
  }
}

export function buildEventFilters(opts: ListOptions): EventFilters {
  return {
    search: opts.search,
    ...(opts.filters as Partial<EventFilters>),
  }
}

export function buildEmailFilters(opts: ListOptions): EmailFilters {
  return {
    search: opts.search,
    ...(opts.filters as Partial<EmailFilters>),
  }
}

export function buildTraceFilters(opts: ListOptions): TraceFilters {
  return {
    search: opts.search,
    ...(opts.filters as Partial<TraceFilters>),
  }
}

export function buildLogFilters(opts: ListOptions): LogFilters {
  return {
    search: opts.search,
    ...(opts.filters as Partial<LogFilters>),
  }
}

// ---------------------------------------------------------------------------
// Email stripping
// ---------------------------------------------------------------------------

/** Strip heavy html/text bodies from email records for list view. */
export function stripEmailForList(e: {
  id: number
  from: string
  to: string
  cc?: string | null
  bcc?: string | null
  subject: string
  mailer: string
  status: string
  messageId?: string | null
  attachmentCount?: number
  timestamp?: string | number | null
}) {
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    cc: e.cc,
    bcc: e.bcc,
    subject: e.subject,
    mailer: e.mailer,
    status: e.status,
    messageId: e.messageId,
    attachmentCount: e.attachmentCount,
    timestamp: e.timestamp,
  }
}

// ---------------------------------------------------------------------------
// Trace list stripping
// ---------------------------------------------------------------------------

/** Strip spans from trace records for list view. */
export function stripTraceForList(t: {
  id: number
  method: string
  url: string
  statusCode: number
  totalDuration: number
  spanCount: number
  warnings: readonly unknown[]
  timestamp?: string | number | null
}) {
  return {
    id: t.id,
    method: t.method,
    url: t.url,
    statusCode: t.statusCode,
    totalDuration: t.totalDuration,
    spanCount: t.spanCount,
    warningCount: t.warnings.length,
    timestamp: t.timestamp,
  }
}

// ---------------------------------------------------------------------------
// Route search
// ---------------------------------------------------------------------------

/** Filter routes by search term across pattern, handler, name, and method. */
export function filterRoutes(routes: RouteRecord[], search: string): RouteRecord[] {
  const term = search.toLowerCase()
  return routes.filter((r) => {
    const pattern = (r.pattern || '').toLowerCase()
    const handler = (r.handler || '').toLowerCase()
    const name = (r.name || '').toLowerCase()
    const method = (r.method || '').toLowerCase()
    return (
      pattern.includes(term) ||
      handler.includes(term) ||
      name.includes(term) ||
      method.includes(term)
    )
  })
}

// ---------------------------------------------------------------------------
// Log file reader
// ---------------------------------------------------------------------------

/**
 * Read and parse the last 256 KB of a log file.
 *
 * Returns an array of enriched log entry objects. If the log file
 * does not exist or cannot be read, returns an empty array.
 */
export async function readLogFile(logPath: string): Promise<Record<string, unknown>[]> {
  try {
    const stats = await stat(logPath)
    const content = await readLogContent(logPath, stats.size)

    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => parseAndEnrich(line))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .reverse()
  } catch {
    return []
  }
}

/** Read the last maxBytes of a file, skipping partial first line if truncated. */
async function readLogContent(logPath: string, fileSize: number): Promise<string> {
  const maxBytes = 256 * 1024

  if (fileSize <= maxBytes) {
    return readFile(logPath, 'utf-8')
  }

  const { createReadStream } = await import('node:fs')
  const stream = createReadStream(logPath, {
    start: fileSize - maxBytes,
    encoding: 'utf-8',
  })
  const chunks: string[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as string)
  }
  let content = chunks.join('')
  // Skip first potentially incomplete line
  const firstNewline = content.indexOf('\n')
  if (firstNewline !== -1) content = content.slice(firstNewline + 1)
  return content
}

// Re-export types that DataAccess needs
export type { DashboardStore, QueryFilters, EventFilters, EmailFilters, TraceFilters, LogFilters }
export type { DebugStore }
export type { QueryRecord, EventRecord, TraceRecord, RouteRecord }

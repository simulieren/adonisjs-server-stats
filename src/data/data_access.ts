import { readFile, stat } from 'node:fs/promises'

import { parseAndEnrich } from '../log_stream/log_stream_service.js'

import type { DebugStore } from '../debug/debug_store.js'
import type {
  QueryRecord,
  EventRecord,
  EmailRecord,
  TraceRecord,
  RouteRecord,
} from '../debug/types.js'
import type {
  DashboardStore,
  QueryFilters,
  EventFilters,
  EmailFilters,
  TraceFilters,
  LogFilters,
} from '../dashboard/dashboard_store.js'

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a plain array in the standard {@link PaginatedResult} envelope.
 *
 * Applies optional client-side search filtering and pagination so that
 * ring-buffer results match the same shape returned by the dashboard store.
 */
function wrapArray<T>(
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
function fromDashboardResult<T>(result: {
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
// DataAccess
// ---------------------------------------------------------------------------

/**
 * Thin abstraction layer that delegates reads to either the
 * {@link DashboardStore} (SQLite persistence) or the {@link DebugStore}
 * (in-memory ring buffers), depending on availability.
 *
 * This is intentionally *not* wired into the AdonisJS container yet
 * -- that happens in Phase 3.
 */
export class DataAccess {
  constructor(
    private debugStore: DebugStore,
    private dashboardStore: DashboardStore | null,
    private logPath?: string
  ) {}

  /** Whether SQLite persistence is available and initialised. */
  get hasPersistence(): boolean {
    return this.dashboardStore?.isReady() ?? false
  }

  // =========================================================================
  // Queries
  // =========================================================================

  async getQueries(opts: ListOptions = {}): Promise<PaginatedResult<QueryRecord>> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const page = opts.page ?? 1
      const perPage = opts.perPage ?? 50
      const filters: QueryFilters = {
        search: opts.search,
        ...(opts.filters as Partial<QueryFilters>),
      }
      const result = await this.dashboardStore!.getQueries(page, perPage, filters)
      return fromDashboardResult(result) as unknown as PaginatedResult<QueryRecord>
    }

    const queries = this.debugStore.queries.getQueries()
    return wrapArray<QueryRecord>(queries, opts, (q, term) => {
      return (
        q.sql.toLowerCase().includes(term) ||
        (q.model?.toLowerCase().includes(term) ?? false) ||
        q.connection.toLowerCase().includes(term)
      )
    })
  }

  getQuerySummary(): { total: number; slow: number; duplicates: number; avgDuration: number } {
    return this.debugStore.queries.getSummary()
  }

  // =========================================================================
  // Events
  // =========================================================================

  async getEvents(opts: ListOptions = {}): Promise<PaginatedResult<EventRecord>> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const page = opts.page ?? 1
      const perPage = opts.perPage ?? 50
      const filters: EventFilters = {
        search: opts.search,
        ...(opts.filters as Partial<EventFilters>),
      }
      const result = await this.dashboardStore!.getEvents(page, perPage, filters)
      return fromDashboardResult(result) as unknown as PaginatedResult<EventRecord>
    }

    const events = this.debugStore.events.getEvents()
    return wrapArray<EventRecord>(events, opts, (e, term) => {
      return e.event.toLowerCase().includes(term)
    })
  }

  // =========================================================================
  // Emails
  // =========================================================================

  /**
   * Paginated email list.
   *
   * HTML and text bodies are stripped from the list response to keep
   * payloads lightweight. Use {@link getEmailPreview} for the full body.
   */
  async getEmails(opts: ListOptions = {}): Promise<PaginatedResult> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const page = opts.page ?? 1
      const perPage = opts.perPage ?? 50
      const filters: EmailFilters = {
        search: opts.search,
        ...(opts.filters as Partial<EmailFilters>),
      }
      const result = await this.dashboardStore!.getEmails(page, perPage, filters, true)
      return fromDashboardResult(result)
    }

    const emails = this.debugStore.emails.getEmails()
    // Strip html/text from list response
    const stripped = emails.map(({ html: _html, text: _text, ...rest }) => rest)
    return wrapArray(stripped, opts, (e: Omit<EmailRecord, 'html' | 'text'>, term: string) => {
      return (
        e.from.toLowerCase().includes(term) ||
        e.to.toLowerCase().includes(term) ||
        e.subject.toLowerCase().includes(term)
      )
    })
  }

  /**
   * Get email HTML body for preview (iframe rendering).
   *
   * Returns the full HTML body string, or falls back to the text body.
   * Returns `null` when the email is not found.
   */
  async getEmailPreview(id: number, source?: 'memory' | 'auto'): Promise<string | null> {
    if (this.hasPersistence && source !== 'memory') {
      return this.dashboardStore!.getEmailHtml(id)
    }

    return this.debugStore.emails.getEmailHtml(id)
  }

  // =========================================================================
  // Traces
  // =========================================================================

  /**
   * Paginated trace list.
   *
   * Span arrays are stripped from the list response to keep payloads
   * lightweight. Use {@link getTraceDetail} for the full span tree.
   */
  async getTraces(opts: ListOptions = {}): Promise<PaginatedResult> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const page = opts.page ?? 1
      const perPage = opts.perPage ?? 50
      const filters: TraceFilters = {
        search: opts.search,
        ...(opts.filters as Partial<TraceFilters>),
      }
      const result = await this.dashboardStore!.getTraces(page, perPage, filters)
      return fromDashboardResult(result)
    }

    if (!this.debugStore.traces) {
      return { data: [], meta: { total: 0, page: 1, perPage: opts.perPage ?? 50, lastPage: 1 } }
    }

    const traces = this.debugStore.traces.getTraces()
    // Strip spans from list view, add warningCount
    const list = traces.map(({ spans: _spans, warnings, ...rest }) => ({
      ...rest,
      warningCount: warnings.length,
    }))

    return wrapArray(list, opts, (t, term: string) => {
      return (
        t.method.toLowerCase().includes(term) || t.url.toLowerCase().includes(term)
      )
    })
  }

  /**
   * Get a single trace with full span tree.
   *
   * Returns `null` when the trace is not found.
   */
  async getTraceDetail(id: number, source?: 'memory' | 'auto'): Promise<TraceRecord | null> {
    if (this.hasPersistence && source !== 'memory') {
      return this.dashboardStore!.getTraceDetail(id) as Promise<TraceRecord | null>
    }

    if (!this.debugStore.traces) return null
    return this.debugStore.traces.getTrace(id) ?? null
  }

  // =========================================================================
  // Routes
  // =========================================================================

  /**
   * Get the registered route table.
   *
   * Routes are always read from the in-memory {@link DebugStore} because
   * they are static boot-time data that is never persisted to SQLite.
   */
  getRoutes(search?: string): PaginatedResult<RouteRecord> {
    let routes = this.debugStore.routes.getRoutes()

    if (search) {
      const term = search.toLowerCase()
      routes = routes.filter((r) => {
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

    const total = routes.length
    return {
      data: routes,
      meta: { total, page: 1, perPage: total || 1, lastPage: 1 },
    }
  }

  // =========================================================================
  // Logs
  // =========================================================================

  /**
   * Paginated log entries.
   *
   * When the dashboard store is available, logs are read from SQLite with
   * full server-side filtering. Otherwise, falls back to reading the last
   * 256 KB of the application log file from the filesystem.
   */
  async getLogs(opts: ListOptions = {}): Promise<PaginatedResult> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const page = opts.page ?? 1
      const perPage = opts.perPage ?? 50
      const filters: LogFilters = {
        search: opts.search,
        ...(opts.filters as Partial<LogFilters>),
      }
      const result = await this.dashboardStore!.getLogs(page, perPage, filters)
      return fromDashboardResult(result)
    }

    // Fallback: read from log file on disk (same approach as DebugController)
    const entries = await this.readLogFile()
    return wrapArray(entries, opts, (e: Record<string, unknown>, term: string) => {
      const msg = String(e.msg ?? e.message ?? '').toLowerCase()
      const levelName = String(e.levelName ?? '').toLowerCase()
      return msg.includes(term) || levelName.includes(term)
    })
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Read and parse the last 256 KB of the application log file.
   *
   * Returns an array of enriched log entry objects. If the log file
   * does not exist or cannot be read, returns an empty array.
   */
  private async readLogFile(): Promise<Record<string, unknown>[]> {
    if (!this.logPath) return []

    try {
      const stats = await stat(this.logPath)
      const maxBytes = 256 * 1024
      let content: string

      if (stats.size > maxBytes) {
        const { createReadStream } = await import('node:fs')
        const stream = createReadStream(this.logPath, {
          start: stats.size - maxBytes,
          encoding: 'utf-8',
        })
        const chunks: string[] = []
        for await (const chunk of stream) {
          chunks.push(chunk as string)
        }
        content = chunks.join('')
        // Skip first potentially incomplete line
        const firstNewline = content.indexOf('\n')
        if (firstNewline !== -1) content = content.slice(firstNewline + 1)
      } else {
        content = await readFile(this.logPath, 'utf-8')
      }

      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => parseAndEnrich(line))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    } catch {
      return []
    }
  }
}

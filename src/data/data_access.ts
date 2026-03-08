import {
  wrapArray,
  fromDashboardResult,
  mapTraceListRow,
  normalizeEmailRow,
  buildPaginationArgs,
  buildQueryFilters,
  buildEventFilters,
  buildEmailFilters,
  buildTraceFilters,
  buildLogFilters,
  stripEmailForList,
  stripTraceForList,
  filterRoutes,
  readLogFile,
} from './data_access_helpers.js'

import type {
  ListOptions,
  PaginatedResult,
  DashboardStore,
  DebugStore,
  QueryRecord,
  EventRecord,
  TraceRecord,
  RouteRecord,
} from './data_access_helpers.js'

export type { ListOptions, PaginatedResult }

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
  private debugStore: DebugStore
  private getDashboardStore: () => DashboardStore | null
  private logPath?: string

  constructor(
    debugStore: DebugStore,
    dashboardStore: DashboardStore | null | (() => DashboardStore | null),
    logPath?: string
  ) {
    this.debugStore = debugStore
    this.getDashboardStore =
      typeof dashboardStore === 'function' ? dashboardStore : () => dashboardStore
    this.logPath = logPath
  }

  /** Whether SQLite persistence is available and initialised. */
  get hasPersistence(): boolean {
    return this.getDashboardStore()?.isReady() ?? false
  }

  /** Resolve the dashboard store (may be null if not yet initialized). */
  private get dashboardStore(): DashboardStore | null {
    return this.getDashboardStore()
  }

  // =========================================================================
  // Queries
  // =========================================================================

  async getQueries(opts: ListOptions = {}): Promise<PaginatedResult<QueryRecord>> {
    if (this.hasPersistence && opts.source !== 'memory') {
      const { page, perPage } = buildPaginationArgs(opts)
      const result = await this.dashboardStore!.getQueries(page, perPage, buildQueryFilters(opts))
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
      const { page, perPage } = buildPaginationArgs(opts)
      const result = await this.dashboardStore!.getEvents(page, perPage, buildEventFilters(opts))
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
      const { page, perPage } = buildPaginationArgs(opts)
      const result = await this.dashboardStore!.getEmails(page, perPage, buildEmailFilters(opts), true)
      const normalized = fromDashboardResult(result)
      normalized.data = (normalized.data as Record<string, unknown>[]).map(normalizeEmailRow)
      return normalized
    }

    const emails = this.debugStore.emails.getEmails()
    const stripped = emails.map(stripEmailForList)
    return wrapArray(stripped, opts, (e, term: string) => {
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
      const { page, perPage } = buildPaginationArgs(opts)
      const result = await this.dashboardStore!.getTraces(page, perPage, buildTraceFilters(opts))
      return {
        ...fromDashboardResult(result),
        data: result.data.map(mapTraceListRow),
      }
    }

    if (!this.debugStore.traces) {
      return { data: [], meta: { total: 0, page: 1, perPage: opts.perPage ?? 50, lastPage: 1 } }
    }

    const traces = this.debugStore.traces.getTraces()
    const list = traces.map(stripTraceForList)

    return wrapArray(list, opts, (t, term: string) => {
      return t.method.toLowerCase().includes(term) || t.url.toLowerCase().includes(term)
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
    const trace = this.debugStore.traces.getTrace(id) ?? null
    if (!trace) return null

    // Enrich with related logs by httpRequestId
    if (trace.httpRequestId) {
      const logs = await this.getRelatedLogsByRequestId(trace.httpRequestId)
      if (logs.length > 0) {
        return { ...trace, logs }
      }
    }

    return trace
  }

  /**
   * Find log entries matching a specific request ID.
   */
  private async getRelatedLogsByRequestId(
    requestId: string
  ): Promise<Record<string, unknown>[]> {
    if (this.hasPersistence) {
      try {
        const result = await this.dashboardStore!.getLogs(1, 50, { requestId })
        return result.data
      } catch {
        // Fall through to log file
      }
    }

    const entries = this.logPath ? await readLogFile(this.logPath) : []
    return entries.filter(
      (e) => e.request_id === requestId || e.requestId === requestId
    )
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
      routes = filterRoutes(routes, search)
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
      const { page, perPage } = buildPaginationArgs(opts)
      const result = await this.dashboardStore!.getLogs(page, perPage, buildLogFilters(opts))
      return fromDashboardResult(result)
    }

    const entries = this.logPath ? await readLogFile(this.logPath) : []
    return wrapArray(entries, opts, (e: Record<string, unknown>, term: string) => {
      const msg = String(e.msg ?? e.message ?? '').toLowerCase()
      const levelName = String(e.levelName ?? '').toLowerCase()
      return msg.includes(term) || levelName.includes(term)
    })
  }
}

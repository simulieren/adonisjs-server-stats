import type { DataAccess, ListOptions, PaginatedResult } from '../data/data_access.js'
import type { EventRecord, QueryRecord, RouteRecord, TraceRecord } from '../debug/types.js'

/**
 * Unified API controller for all data resource endpoints.
 *
 * Delegates every read operation to the {@link DataAccess} abstraction layer,
 * which transparently routes to either the in-memory {@link DebugStore}
 * (ring buffers) or the persistent {@link DashboardStore} (SQLite),
 * depending on availability.
 *
 * This controller is intentionally **transport-agnostic** — it knows
 * nothing about HTTP, `HttpContext`, or response formatting. Route
 * handlers in {@link registerAllRoutes} call these methods and write
 * the result to the response themselves.
 *
 * @example
 * ```ts
 * const api = new ApiController(dataAccess)
 * const result = await api.getQueries({ page: 1, perPage: 25, search: 'users' })
 * // → { data: [...], meta: { total, page, perPage, lastPage } }
 * ```
 */
export class ApiController {
  constructor(private data: DataAccess) {}

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Paginated list of captured SQL queries.
   *
   * Supports full-text search across `sql`, `model`, and `connection`
   * fields, plus optional filter parameters forwarded to the underlying
   * store (e.g. `durationMin`, `method`, `connection`).
   */
  async getQueries(opts: ListOptions = {}): Promise<PaginatedResult<QueryRecord>> {
    return this.data.getQueries(opts)
  }

  /**
   * Aggregate query statistics from the in-memory ring buffer.
   *
   * Returns total count, number of slow queries, duplicate count,
   * and the average execution duration.
   *
   * **Note:** This always reads from the {@link DebugStore} because
   * summary metrics are computed in-memory and not persisted.
   */
  getQuerySummary(): { total: number; slow: number; duplicates: number; avgDuration: number } {
    return this.data.getQuerySummary()
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Paginated list of captured application events.
   *
   * Supports full-text search on the event name.
   */
  async getEvents(opts: ListOptions = {}): Promise<PaginatedResult<EventRecord>> {
    return this.data.getEvents(opts)
  }

  // ===========================================================================
  // Emails
  // ===========================================================================

  /**
   * Paginated list of captured emails.
   *
   * HTML and text bodies are stripped from the list response to keep
   * payloads lightweight. Use {@link getEmailPreview} for the full body.
   */
  async getEmails(opts: ListOptions = {}): Promise<PaginatedResult> {
    return this.data.getEmails(opts)
  }

  /**
   * Get the HTML body of a single email for iframe preview rendering.
   *
   * Returns the full HTML string, or falls back to the plain-text body.
   * Returns `null` when the email is not found.
   */
  async getEmailPreview(id: number, source?: 'memory' | 'auto'): Promise<string | null> {
    return this.data.getEmailPreview(id, source)
  }

  // ===========================================================================
  // Traces
  // ===========================================================================

  /**
   * Paginated list of captured request traces.
   *
   * Span arrays are stripped from the list response to keep payloads
   * lightweight. Use {@link getTraceDetail} for the full span tree.
   */
  async getTraces(opts: ListOptions = {}): Promise<PaginatedResult> {
    return this.data.getTraces(opts)
  }

  /**
   * Get a single trace with its full span tree.
   *
   * Returns `null` when the trace is not found or tracing is disabled.
   */
  async getTraceDetail(id: number, source?: 'memory' | 'auto'): Promise<TraceRecord | null> {
    return this.data.getTraceDetail(id, source)
  }

  // ===========================================================================
  // Routes
  // ===========================================================================

  /**
   * Get the registered route table.
   *
   * Routes are always read from the in-memory {@link DebugStore} because
   * they are static boot-time data that is never persisted to SQLite.
   *
   * Supports optional search filtering across pattern, handler, name,
   * and HTTP method fields.
   */
  getRoutes(search?: string): PaginatedResult<RouteRecord> {
    return this.data.getRoutes(search)
  }

  // ===========================================================================
  // Logs
  // ===========================================================================

  /**
   * Paginated list of log entries.
   *
   * When the dashboard store is available, logs are read from SQLite
   * with full server-side filtering. Otherwise, falls back to reading
   * the last 256 KB of the application log file from the filesystem.
   */
  async getLogs(opts: ListOptions = {}): Promise<PaginatedResult> {
    return this.data.getLogs(opts)
  }
}

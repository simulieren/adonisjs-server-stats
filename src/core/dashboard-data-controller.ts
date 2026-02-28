// ---------------------------------------------------------------------------
// Framework-agnostic dashboard data controller
// ---------------------------------------------------------------------------
//
// Owns the fetch lifecycle, refresh timers, race-condition guards,
// query-param building, pagination parsing, and section-aware intervals.
//
// React and Vue wrappers create an instance and bridge the callbacks
// to their respective reactivity systems.
// ---------------------------------------------------------------------------

import { ApiClient, UnauthorizedError } from './api-client.js'
import { OVERVIEW_REFRESH_MS, SECTION_REFRESH_MS } from './constants.js'
import { DashboardApi } from './dashboard-api.js'
import { buildQueryParams } from './pagination.js'

import type { DashboardSection, PaginatedResponse } from './types.js'

// ---------------------------------------------------------------------------
// Config / callback types
// ---------------------------------------------------------------------------

/**
 * Callbacks invoked by the controller to push state changes into
 * the host framework's reactivity layer.
 */
export interface DashboardDataCallbacks {
  /** Called with the latest data payload (or `null` on reset). */
  onData: (data: unknown) => void
  /** Called with pagination meta (or `null` when non-paginated). */
  onPagination: (meta: PaginatedResponse<unknown>['meta'] | null) => void
  /** Called when the loading flag changes. */
  onLoading: (loading: boolean) => void
  /** Called when an error occurs (or `null` to clear). */
  onError: (error: Error | null) => void
  /** Called when an `UnauthorizedError` is detected. */
  onUnauthorized: () => void
}

/**
 * Configuration supplied at construction time.
 */
export interface DashboardDataControllerConfig {
  /** Base URL for API requests (e.g. `''` for same origin). */
  baseUrl: string
  /** Dashboard API base path. Defaults to `'/__stats/api'`. */
  endpoint: string
  /** Optional Bearer auth token. */
  authToken?: string
  /** Initial dashboard section to fetch. */
  section: DashboardSection
  /** Items per page. */
  perPage: number
  /** Callbacks that bridge state changes into the host framework. */
  callbacks: DashboardDataCallbacks
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic controller for the dashboard data lifecycle.
 *
 * Encapsulates:
 * - Query parameter building (with camelCase-to-snake_case sort conversion)
 * - Silent vs non-silent fetch distinction
 * - Paginated / non-paginated response detection
 * - `UnauthorizedError` handling with timer cleanup
 * - Section-aware auto-refresh intervals
 * - `fetchId` race-condition guard
 * - `explicitFetchPending` guard to prevent silent fetch races
 * - Mutation (POST/DELETE) support
 */
export class DashboardDataController {
  // -- Dependencies ---------------------------------------------------------
  private client: ApiClient
  private api: DashboardApi
  private callbacks: DashboardDataCallbacks

  // -- Configuration --------------------------------------------------------
  private endpoint: string
  private perPage: number

  // -- Mutable state --------------------------------------------------------
  private section: DashboardSection
  private page: number = 1
  private search: string | undefined
  private sort: string | undefined
  private sortDir: 'asc' | 'desc' | undefined
  private filters: Record<string, string> | undefined
  private timeRange: string | undefined

  // -- Internal bookkeeping -------------------------------------------------
  private timer: ReturnType<typeof setInterval> | null = null
  /** Monotonically increasing fetch ID to discard stale responses. */
  private fetchId: number = 0
  /** Whether a non-silent (explicit) fetch is currently in-flight. */
  private explicitFetchPending: boolean = false
  /** Whether we have successfully fetched data at least once. */
  private hasFetched: boolean = false
  /** Whether the controller has been stopped (disposed). */
  private stopped: boolean = false

  constructor(config: DashboardDataControllerConfig) {
    this.client = new ApiClient({ baseUrl: config.baseUrl, authToken: config.authToken })
    this.api = new DashboardApi(this.client, config.endpoint)
    this.endpoint = config.endpoint
    this.section = config.section
    this.perPage = config.perPage
    this.callbacks = config.callbacks
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Start the controller: perform an initial fetch and begin auto-refresh.
   */
  start(): void {
    this.stopped = false
    this.fetch(false)
    this.startRefreshTimer()
  }

  /**
   * Stop the controller: clear timers and mark as disposed.
   * Outstanding in-flight responses will be discarded via fetchId.
   */
  stop(): void {
    this.stopped = true
    this.stopRefreshTimer()
  }

  /**
   * Perform a data fetch.
   *
   * @param silent - When `true`, errors are swallowed (keeps stale data)
   *   and loading state is not modified.
   */
  async fetch(silent: boolean = true): Promise<void> {
    // Skip silent refreshes while an explicit fetch is pending to prevent
    // a stale timer/SSE refresh from racing with a user-initiated change.
    if (silent && this.explicitFetchPending) return

    const myFetchId = ++this.fetchId
    const currentSection = this.section
    if (!currentSection) return

    // Snapshot filters before any async work
    const extraFilters = this.filters

    // Convert camelCase column names to snake_case for the API
    const sortParam = this.sort
      ? this.sort.replace(/[A-Z]/g, (c: string) => '_' + c.toLowerCase())
      : undefined

    const qs = buildQueryParams({
      page: this.page,
      perPage: this.perPage,
      search: this.search,
      sort: sortParam,
      sortDir: this.sort ? this.sortDir : undefined,
      filters: extraFilters && Object.keys(extraFilters).length > 0 ? extraFilters : undefined,
      timeRange: currentSection.startsWith('overview') ? this.timeRange : undefined,
    })

    if (!silent) {
      this.callbacks.onLoading(true)
      this.explicitFetchPending = true
    }

    try {
      const result = await this.api.fetchSection(currentSection, qs || undefined)

      // Discard stale responses
      if (myFetchId !== this.fetchId) return
      if (this.stopped) return

      // Handle both paginated and non-paginated responses
      if (
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).data !== undefined &&
        (result as Record<string, unknown>).meta !== undefined
      ) {
        const paginated = result as {
          data: unknown
          meta: PaginatedResponse<unknown>['meta']
        }
        this.callbacks.onData(paginated.data)
        this.callbacks.onPagination(paginated.meta)
      } else {
        this.callbacks.onData(result)
        this.callbacks.onPagination(null)
      }

      this.callbacks.onError(null)
      this.callbacks.onLoading(false)
      this.hasFetched = true
    } catch (err) {
      if (myFetchId !== this.fetchId) return
      if (this.stopped) return

      if (err instanceof UnauthorizedError) {
        this.callbacks.onError(err)
        this.callbacks.onLoading(false)
        this.stopRefreshTimer()
        this.callbacks.onUnauthorized()
        return
      }

      // On silent refresh failures, keep showing stale data
      if (!silent) {
        this.callbacks.onError(err instanceof Error ? err : new Error(String(err)))
        this.callbacks.onLoading(false)
      }
    } finally {
      if (!silent) {
        this.explicitFetchPending = false
      }
    }
  }

  /**
   * Change the active section. Resets pagination, filters, sort, and
   * performs a full (non-silent) fetch.
   */
  setSection(section: DashboardSection): void {
    if (this.section === section) return
    this.section = section
    this.page = 1
    this.search = undefined
    this.sort = undefined
    this.sortDir = undefined
    this.filters = undefined
    this.hasFetched = false

    // Signal full reset to the framework layer
    this.callbacks.onData(null)
    this.callbacks.onPagination(null)
    this.callbacks.onLoading(true)
    this.callbacks.onError(null)

    this.fetch(false)
    // Restart refresh timer with new section's interval
    this.startRefreshTimer()
  }

  /**
   * Navigate to a specific page. Triggers a non-silent fetch.
   */
  setPage(page: number): void {
    this.page = page
    this.fetch(false)
  }

  /**
   * Update the search query. Resets to page 1. Triggers a non-silent fetch.
   */
  setSearch(search: string): void {
    this.search = search || undefined
    this.page = 1
    this.fetch(false)
  }

  /**
   * Set a filter key-value pair. Resets to page 1. Triggers a non-silent fetch.
   */
  setFilter(key: string, value: string | number | boolean): void {
    if (!this.filters) {
      this.filters = {}
    }
    this.filters[key] = String(value)
    this.page = 1
    this.fetch(false)
  }

  /**
   * Update sort column and direction. Triggers a non-silent fetch.
   *
   * If the same column is passed without a direction, toggles asc/desc.
   */
  setSort(column: string, direction?: 'asc' | 'desc'): void {
    if (this.sort === column && !direction) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
    } else {
      this.sort = column
      this.sortDir = direction || 'desc'
    }
    this.fetch(false)
  }

  /**
   * Update the time range. Triggers a non-silent fetch.
   */
  setTimeRange(range: string): void {
    this.timeRange = range
    this.fetch(false)
  }

  /**
   * Execute a mutation (POST/DELETE) against the dashboard API,
   * then silently refresh the current data.
   */
  async mutate(path: string, method: 'post' | 'delete' = 'post', body?: unknown): Promise<unknown> {
    const url = `${this.endpoint}/${path}`
    try {
      const result = method === 'post' ? await this.client.post(url, body) : await this.client.delete(url)
      // Refresh after mutation
      await this.fetch(true)
      return result
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  /**
   * Bulk-update query parameters without triggering a fetch.
   *
   * Used by props-driven frameworks (React) where the host component
   * controls pagination/search/sort state externally and passes it in
   * as props on each render cycle.
   */
  configure(params: {
    page?: number
    perPage?: number
    search?: string
    sort?: string
    sortDir?: 'asc' | 'desc'
    filters?: Record<string, string>
    timeRange?: string
  }): void {
    if (params.page !== undefined) this.page = params.page
    if (params.perPage !== undefined) this.perPage = params.perPage
    this.search = params.search
    this.sort = params.sort
    this.sortDir = params.sortDir
    this.filters = params.filters
    this.timeRange = params.timeRange
  }

  /**
   * Whether data has been fetched at least once.
   */
  hasData(): boolean {
    return this.hasFetched
  }

  /**
   * Handle an external signal (e.g. SSE refreshKey) by performing
   * a silent refresh if data has already been fetched once.
   */
  handleRefreshSignal(): void {
    if (this.hasFetched) {
      this.fetch(true)
    }
  }

  /**
   * Get the underlying `DashboardApi` instance for direct API calls.
   */
  getApi(): DashboardApi {
    return this.api
  }

  /**
   * Get the underlying `ApiClient` instance.
   */
  getClient(): ApiClient {
    return this.client
  }

  // -- Timer management (private) -------------------------------------------

  private startRefreshTimer(): void {
    this.stopRefreshTimer()
    const interval = this.section === 'overview' ? OVERVIEW_REFRESH_MS : SECTION_REFRESH_MS
    this.timer = setInterval(() => this.fetch(true), interval)
  }

  private stopRefreshTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

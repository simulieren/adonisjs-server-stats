/**
 * Vue composable for fetching dashboard data with pagination.
 *
 * Fetches data from the dashboard API endpoints with support
 * for pagination, filtering, sorting, and time range selection.
 *
 * Distinguishes between "initial load" (first mount, section change) and
 * "silent refresh" (auto-poll, refreshKey change) to avoid UI flickering.
 */

import { ref, reactive, watch, onMounted, onUnmounted, type Ref, type WatchSource } from 'vue'

import {
  ApiClient,
  buildQueryParams,
  UnauthorizedError,
  DashboardApi,
  OVERVIEW_REFRESH_MS,
  SECTION_REFRESH_MS,
} from '../../core/index.js'

import type { DashboardSection, PaginationState, TimeRange } from '../../core/index.js'

export interface UseDashboardDataOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Dashboard API base path. */
  dashboardEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
  /** Auto-refresh interval in ms (0 to disable). */
  refreshInterval?: number
  /** Items per page. */
  perPage?: number
  /** Incrementing key to trigger a silent refetch (used by live/SSE mode). */
  refreshKey?: Ref<number> | WatchSource<number>
}

export function useDashboardData(
  section: () => DashboardSection | string,
  options: UseDashboardDataOptions = {}
) {
  const {
    baseUrl = '',
    dashboardEndpoint = '/__stats/api',
    authToken,
    refreshInterval = 5000,
    perPage = 50,
    refreshKey,
  } = options

  const data = ref<unknown>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)
  const timeRange = ref<TimeRange>('1h')

  /** Track whether we have successfully fetched data at least once */
  let hasFetched = false

  const pagination = reactive<PaginationState>({
    page: 1,
    perPage,
    total: 0,
    totalPages: 1,
  })

  const filter = reactive<{ search: string; [key: string]: string | number | boolean }>({
    search: '',
  })

  const sort = reactive<{ column: string; direction: 'asc' | 'desc' }>({
    column: '',
    direction: 'desc',
  })

  const client = new ApiClient({ baseUrl, authToken })
  const api = new DashboardApi(client, dashboardEndpoint)
  let timer: ReturnType<typeof setInterval> | null = null
  /** Monotonically increasing fetch ID to discard responses from stale requests. */
  let fetchId = 0
  /** Whether a non-silent (explicit) fetch is currently in-flight. */
  let explicitFetchPending = false

  /**
   * Build the current filters record from the reactive filter state.
   *
   * Extracts all keys except `search` that have a non-empty value,
   * converting them to strings for the query params.
   */
  function buildFilters(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(filter)) {
      if (key !== 'search' && value !== '' && value !== undefined && value !== null) {
        result[key] = String(value)
      }
    }
    return result
  }

  /**
   * Core fetch logic. When `silent` is true, loading state is not modified
   * and errors are swallowed (keeping stale data visible).
   */
  async function fetchData(silent = false) {
    // Skip silent refreshes while an explicit (non-silent) fetch is pending.
    // This prevents a stale timer/SSE refresh from racing with a user-initiated
    // filter change and overwriting the filtered results.
    if (silent && explicitFetchPending) return

    const myFetchId = ++fetchId
    const currentSection = section()
    if (!currentSection) return

    // Snapshot the current filters before any async work
    const extraFilters = buildFilters()

    // Convert camelCase column names to snake_case for the API (e.g. statusCode -> status_code)
    const sortParam = sort.column
      ? sort.column.replace(/[A-Z]/g, (c: string) => '_' + c.toLowerCase())
      : undefined

    const qs = buildQueryParams({
      page: pagination.page,
      perPage: pagination.perPage,
      search: filter.search || undefined,
      sort: sortParam,
      sortDir: sort.column ? sort.direction : undefined,
      filters: Object.keys(extraFilters).length > 0 ? extraFilters : undefined,
      timeRange: currentSection.startsWith('overview') ? timeRange.value : undefined,
    })

    if (!silent) {
      loading.value = true
      explicitFetchPending = true
    }

    try {
      const result = await api.fetchSection(currentSection, qs || undefined)

      // A newer fetchData call was initiated while we were waiting.
      // Discard this stale response to avoid overwriting fresher data.
      if (myFetchId !== fetchId) return

      // Handle both paginated and non-paginated responses.
      // The API returns { data: [...], meta: { total, page, perPage, lastPage } }.
      if (
        result &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).data !== undefined &&
        (result as Record<string, unknown>).meta !== undefined
      ) {
        const paginated = result as {
          data: unknown
          meta: { total: number; page: number; perPage: number; lastPage: number }
        }
        pagination.total = paginated.meta.total
        pagination.totalPages = paginated.meta.lastPage ?? (Math.ceil(paginated.meta.total / pagination.perPage) || 1)
        data.value = result
      } else if (result && typeof result === 'object' && 'total' in result) {
        // Legacy: some endpoints may return { total, totalPages, ... } at top level
        const paginated = result as { total: number; totalPages?: number }
        pagination.total = paginated.total
        pagination.totalPages =
          paginated.totalPages ?? (Math.ceil(paginated.total / pagination.perPage) || 1)
        data.value = result
      } else {
        data.value = result
      }

      error.value = null
      loading.value = false
      hasFetched = true
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
        loading.value = false
        stopRefresh()
        return
      }

      // On silent refresh failures, keep showing stale data
      if (!silent) {
        error.value = err as Error
        loading.value = false
      }
    } finally {
      if (!silent) {
        explicitFetchPending = false
      }
    }
  }

  /**
   * Fetch chart data with a specific time range.
   */
  async function fetchChart(range: TimeRange): Promise<unknown> {
    try {
      return await api.fetchChart(range)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
      }
      return null
    }
  }

  /**
   * Fetch grouped query data.
   */
  async function fetchGroupedQueries(): Promise<unknown> {
    try {
      return await api.fetchGroupedQueries()
    } catch {
      return null
    }
  }

  /**
   * Run EXPLAIN on a query.
   */
  async function explainQuery(queryId: number): Promise<unknown> {
    try {
      return await api.explainQuery(queryId)
    } catch {
      return null
    }
  }

  /**
   * Retry a failed job.
   */
  async function retryJob(jobId: string): Promise<boolean> {
    try {
      await api.retryJob(jobId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a cache key.
   */
  async function deleteCacheKey(key: string): Promise<boolean> {
    try {
      await api.deleteCacheKey(key)
      return true
    } catch {
      return false
    }
  }

  /**
   * Fetch email HTML preview.
   */
  async function fetchEmailPreview(emailId: number): Promise<string | null> {
    try {
      const result = await api.fetchEmailPreview(emailId)
      return (result as { html?: string })?.html || null
    } catch {
      return null
    }
  }

  /**
   * Execute a mutation (POST/DELETE) against the dashboard API.
   */
  async function mutate(
    path: string,
    method: 'post' | 'delete' = 'post',
    body?: unknown
  ): Promise<unknown> {
    const url = `${dashboardEndpoint}/${path}`
    try {
      const result =
        method === 'post' ? await client.post(url, body) : await client.delete(url)
      // Refresh after mutation
      await fetchData(true)
      return result
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  function goToPage(page: number) {
    pagination.page = page
    fetchData()
  }

  function setSearch(search: string) {
    filter.search = search
    pagination.page = 1
    fetchData()
  }

  function setFilter(key: string, value: string | number | boolean) {
    ;(filter as Record<string, string | number | boolean>)[key] = value
    pagination.page = 1
    fetchData()
  }

  function setSort(column: string, direction?: 'asc' | 'desc') {
    if (sort.column === column && !direction) {
      sort.direction = sort.direction === 'asc' ? 'desc' : 'asc'
    } else {
      sort.column = column
      sort.direction = direction || 'desc'
    }
    fetchData()
  }

  function setTimeRange(range: TimeRange) {
    timeRange.value = range
    fetchData()
  }

  function startRefresh() {
    stopRefresh()
    // Use section-aware intervals: overview refreshes faster than other sections.
    // Fall back to explicit refreshInterval if provided (non-default), otherwise
    // pick the appropriate constant based on the current section.
    const currentSection = section()
    const interval =
      refreshInterval !== 5000
        ? refreshInterval
        : currentSection === 'overview'
          ? OVERVIEW_REFRESH_MS
          : SECTION_REFRESH_MS
    if (interval > 0) {
      timer = setInterval(() => fetchData(true), interval)
    }
  }

  function stopRefresh() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function refresh() {
    fetchData(true)
  }

  // Watch for section changes - reset state and do a full (non-silent) load
  watch(section, () => {
    pagination.page = 1
    // Clear all filter keys, not just search, so stale filters from the
    // previous section don't leak into the new one.
    for (const key of Object.keys(filter)) {
      if (key === 'search') {
        filter.search = ''
      } else {
        delete (filter as Record<string, unknown>)[key]
      }
    }
    sort.column = ''
    data.value = null
    hasFetched = false
    fetchData()
    // Restart refresh timer with new section's interval
    startRefresh()
  })

  // Watch refreshKey for SSE-triggered silent refreshes
  if (refreshKey) {
    watch(refreshKey, () => {
      if (hasFetched) {
        // Silent refresh: don't show loading, keep stale data visible
        fetchData(true)
      }
    })
  }

  onMounted(() => {
    fetchData()
    startRefresh()
  })

  onUnmounted(() => {
    stopRefresh()
  })

  return {
    data,
    loading,
    error,
    isUnauthorized,
    pagination,
    filter,
    sort,
    timeRange,
    goToPage,
    setSearch,
    setFilter,
    setSort,
    setTimeRange,
    refresh,
    startRefresh,
    stopRefresh,
    mutate,
    fetchChart,
    fetchGroupedQueries,
    explainQuery,
    retryJob,
    deleteCacheKey,
    fetchEmailPreview,
  }
}

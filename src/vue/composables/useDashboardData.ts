/**
 * Vue composable for fetching dashboard data with pagination.
 *
 * Fetches data from the dashboard API endpoints with support
 * for pagination, filtering, sorting, and time range selection.
 */

import { ref, reactive, watch, onMounted, onUnmounted } from 'vue'

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
  } = options

  const data = ref<any>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)
  const timeRange = ref<TimeRange>('1h')

  const pagination = reactive<PaginationState>({
    page: 1,
    perPage,
    total: 0,
    totalPages: 1,
  })

  const filter = reactive<{ search: string; [key: string]: any }>({
    search: '',
  })

  const sort = reactive<{ column: string; direction: 'asc' | 'desc' }>({
    column: '',
    direction: 'desc',
  })

  const client = new ApiClient({ baseUrl, authToken })
  const api = new DashboardApi(client, dashboardEndpoint)
  let timer: ReturnType<typeof setInterval> | null = null

  async function fetchData() {
    const currentSection = section()
    if (!currentSection) return

    const qs = buildQueryParams({
      page: pagination.page,
      perPage: pagination.perPage,
      search: filter.search || undefined,
      sort: sort.column || undefined,
      sortDir: sort.column ? sort.direction : undefined,
      timeRange: currentSection === 'overview' ? timeRange.value : undefined,
    })

    loading.value = true
    try {
      const result = await api.fetchSection(currentSection, qs || undefined)

      // Handle paginated responses
      if (result && typeof result === 'object' && 'total' in result) {
        pagination.total = result.total
        pagination.totalPages =
          result.totalPages ?? (Math.ceil(result.total / pagination.perPage) || 1)
      }

      data.value = result
      error.value = null
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
        stopRefresh()
      } else {
        error.value = err as Error
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch chart data with a specific time range.
   */
  async function fetchChart(range: TimeRange): Promise<any> {
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
  async function fetchGroupedQueries(): Promise<any> {
    try {
      return await api.fetchGroupedQueries()
    } catch {
      return null
    }
  }

  /**
   * Run EXPLAIN on a query.
   */
  async function explainQuery(queryId: number): Promise<any> {
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
      return result?.html || null
    } catch {
      return null
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
    ;(filter as any)[key] = value
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
      timer = setInterval(fetchData, interval)
    }
  }

  function stopRefresh() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function refresh() {
    fetchData()
  }

  // Watch for section changes
  watch(section, () => {
    pagination.page = 1
    filter.search = ''
    sort.column = ''
    data.value = null
    fetchData()
  })

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
    fetchChart,
    fetchGroupedQueries,
    explainQuery,
    retryJob,
    deleteCacheKey,
    fetchEmailPreview,
  }
}

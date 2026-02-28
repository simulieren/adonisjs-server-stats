/**
 * Vue composable for fetching dashboard data with pagination.
 *
 * Thin wrapper around {@link DashboardDataController} that bridges
 * the controller's callbacks to Vue reactive state.
 *
 * Vue-specific convenience methods (fetchChart, fetchGroupedQueries, etc.)
 * that call DashboardApi directly are kept here since React sections call
 * DashboardApi directly instead.
 */

import { ref, reactive, watch, onMounted, onUnmounted, type Ref, type WatchSource } from 'vue'

import {
  DashboardDataController,
  UnauthorizedError,
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
    perPage = 50,
    refreshKey,
  } = options

  const data = ref<unknown>(null)
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

  const filter = reactive<{ search: string; [key: string]: string | number | boolean }>({
    search: '',
  })

  const sort = reactive<{ column: string; direction: 'asc' | 'desc' }>({
    column: '',
    direction: 'desc',
  })

  // -- Controller setup -----------------------------------------------------

  const controller = new DashboardDataController({
    baseUrl,
    endpoint: dashboardEndpoint,
    authToken,
    section: section() as DashboardSection,
    perPage,
    callbacks: {
      onData: (d) => {
        // For paginated responses the controller splits data/meta for us.
        // However Vue components expect `data.value` to be the full response
        // object when paginated ({ data, meta }), so we store the raw result.
        // The controller calls onData with just the data portion and onPagination
        // with the meta. We reconstruct the full shape here if meta is present.
        pendingData = d
      },
      onPagination: (meta) => {
        if (meta) {
          pagination.total = meta.total
          pagination.totalPages = meta.lastPage ?? (Math.ceil(meta.total / pagination.perPage) || 1)
          // Store the full { data, meta } shape that Vue components expect
          data.value = { data: pendingData, meta }
        } else {
          data.value = pendingData
        }
      },
      onLoading: (l) => {
        loading.value = l
      },
      onError: (e) => {
        error.value = e
      },
      onUnauthorized: () => {
        isUnauthorized.value = true
      },
    },
  })

  /** Temporary storage for data between onData and onPagination calls. */
  let pendingData: unknown = null

  // -- Convenience methods wrapping DashboardApi directly -------------------

  const api = controller.getApi()

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

  async function fetchGroupedQueries(): Promise<unknown> {
    try {
      return await api.fetchGroupedQueries()
    } catch {
      return null
    }
  }

  async function explainQuery(queryId: number): Promise<unknown> {
    try {
      return await api.explainQuery(queryId)
    } catch {
      return null
    }
  }

  async function retryJob(jobId: string): Promise<boolean> {
    try {
      await api.retryJob(jobId)
      return true
    } catch {
      return false
    }
  }

  async function deleteCacheKey(key: string): Promise<boolean> {
    try {
      await api.deleteCacheKey(key)
      return true
    } catch {
      return false
    }
  }

  async function fetchEmailPreview(emailId: number): Promise<string | null> {
    try {
      const result = await api.fetchEmailPreview(emailId)
      return (result as { html?: string })?.html || null
    } catch {
      return null
    }
  }

  // -- Delegation methods ---------------------------------------------------

  function goToPage(page: number) {
    pagination.page = page
    syncAndFetch()
  }

  function setSearch(search: string) {
    filter.search = search
    pagination.page = 1
    syncAndFetch()
  }

  function setFilter(key: string, value: string | number | boolean) {
    ;(filter as Record<string, string | number | boolean>)[key] = value
    pagination.page = 1
    syncAndFetch()
  }

  function setSort(column: string, direction?: 'asc' | 'desc') {
    if (sort.column === column && !direction) {
      sort.direction = sort.direction === 'asc' ? 'desc' : 'asc'
    } else {
      sort.column = column
      sort.direction = direction || 'desc'
    }
    syncAndFetch()
  }

  function setTimeRange(range: TimeRange) {
    timeRange.value = range
    syncAndFetch()
  }

  async function mutate(
    path: string,
    method: 'post' | 'delete' = 'post',
    body?: unknown
  ): Promise<unknown> {
    return controller.mutate(path, method, body)
  }

  function refresh() {
    syncParams()
    controller.fetch(true)
  }

  function startRefresh() {
    controller.start()
  }

  function stopRefresh() {
    controller.stop()
  }

  // -- Param synchronisation ------------------------------------------------

  /** Build the current extra filters record from the reactive filter state. */
  function buildFilters(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(filter)) {
      if (key !== 'search' && value !== '' && value !== undefined && value !== null) {
        result[key] = String(value)
      }
    }
    return result
  }

  /** Push current reactive state into the controller without fetching. */
  function syncParams() {
    const currentSection = section()
    const extraFilters = buildFilters()
    controller.configure({
      page: pagination.page,
      perPage: pagination.perPage,
      search: filter.search || undefined,
      sort: sort.column || undefined,
      sortDir: sort.column ? sort.direction : undefined,
      filters: Object.keys(extraFilters).length > 0 ? extraFilters : undefined,
      timeRange: currentSection.startsWith('overview') ? timeRange.value : undefined,
    })
  }

  /** Sync params then trigger a non-silent fetch. */
  function syncAndFetch() {
    syncParams()
    controller.fetch(false)
  }

  // -- Watchers -------------------------------------------------------------

  // Watch for section changes - reset state and do a full (non-silent) load
  watch(section, () => {
    pagination.page = 1
    // Clear all filter keys so stale filters from the previous section
    // don't leak into the new one.
    for (const key of Object.keys(filter)) {
      if (key === 'search') {
        filter.search = ''
      } else {
        delete (filter as Record<string, unknown>)[key]
      }
    }
    sort.column = ''
    data.value = null

    controller.setSection(section() as DashboardSection)
    syncParams()
  })

  // Watch refreshKey for SSE-triggered silent refreshes
  if (refreshKey) {
    watch(refreshKey, () => {
      syncParams()
      controller.handleRefreshSignal()
    })
  }

  // -- Lifecycle ------------------------------------------------------------

  onMounted(() => {
    syncParams()
    controller.start()
  })

  onUnmounted(() => {
    controller.stop()
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

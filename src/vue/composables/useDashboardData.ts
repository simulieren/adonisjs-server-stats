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

import { DashboardDataController, UnauthorizedError } from '../../core/index.js'

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

/** Reactive refs used by the composable. */
interface DashboardRefs {
  data: Ref<unknown>
  loading: Ref<boolean>
  error: Ref<Error | null>
  isUnauthorized: Ref<boolean>
  timeRange: Ref<TimeRange>
  pagination: PaginationState
  filter: { search: string; [key: string]: string | number | boolean }
  sort: { column: string; direction: 'asc' | 'desc' }
}

/** Build controller callbacks from reactive refs. */
function buildCallbacks(refs: DashboardRefs): import('../../core/index.js').DashboardDataCallbacks {
  let pendingData: unknown = null

  return {
    onData: (d) => {
      pendingData = d
    },
    onPagination: (meta) => {
      if (meta) {
        refs.pagination.total = meta.total
        refs.pagination.totalPages =
          meta.lastPage ?? (Math.ceil(meta.total / refs.pagination.perPage) || 1)
        refs.data.value = { data: pendingData, meta }
      } else {
        refs.data.value = pendingData
      }
    },
    onLoading: (l) => {
      refs.loading.value = l
    },
    onError: (e) => {
      refs.error.value = e
    },
    onUnauthorized: () => {
      refs.isUnauthorized.value = true
    },
  }
}

/** Build the current extra filters record from the reactive filter state. */
function buildFilters(filter: DashboardRefs['filter']): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(filter)) {
    if (key !== 'search' && value !== '' && value !== undefined && value !== null) {
      result[key] = String(value)
    }
  }
  return result
}

/** Wrap a DashboardApi method with try/catch returning null on error. */
async function safeApiCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

/** Create read-only API helper methods. */
function createReadApiHelpers(api: import('../../core/index.js').DashboardApi) {
  return {
    fetchGroupedQueries: () => safeApiCall(() => api.fetchGroupedQueries()),
    explainQuery: (queryId: number) => safeApiCall(() => api.explainQuery(queryId)),
    fetchEmailPreview: async (emailId: number): Promise<string | null> => {
      const result = await safeApiCall(() => api.fetchEmailPreview(emailId))
      return (result as { html?: string })?.html || null
    },
  }
}

/** Create mutation API helper methods. */
function createMutationApiHelpers(api: import('../../core/index.js').DashboardApi) {
  return {
    retryJob: async (jobId: string): Promise<boolean> => {
      try {
        await api.retryJob(jobId)
        return true
      } catch {
        return false
      }
    },
    deleteCacheKey: async (key: string): Promise<boolean> => {
      try {
        await api.deleteCacheKey(key)
        return true
      } catch {
        return false
      }
    },
  }
}

/** Create chart API helper with UnauthorizedError handling. */
function createChartHelper(
  api: import('../../core/index.js').DashboardApi,
  isUnauthorized: Ref<boolean>
) {
  return {
    fetchChart: async (range: TimeRange): Promise<unknown> => {
      try {
        return await api.fetchChart(range)
      } catch (err) {
        if (err instanceof UnauthorizedError) isUnauthorized.value = true
        return null
      }
    },
  }
}

/** Push current reactive state into the controller without fetching. */
function syncControllerParams(
  controller: DashboardDataController,
  section: () => DashboardSection | string,
  refs: DashboardRefs
): void {
  const currentSection = section()
  const extraFilters = buildFilters(refs.filter)
  controller.configure({
    page: refs.pagination.page,
    perPage: refs.pagination.perPage,
    search: refs.filter.search || undefined,
    sort: refs.sort.column || undefined,
    sortDir: refs.sort.column ? refs.sort.direction : undefined,
    filters: Object.keys(extraFilters).length > 0 ? extraFilters : undefined,
    timeRange: currentSection.startsWith('overview') ? refs.timeRange.value : undefined,
  })
}

/** Build page/search/filter navigation methods. */
function buildNavigationMethods(refs: DashboardRefs, syncAndFetch: () => void) {
  return {
    goToPage(page: number) {
      refs.pagination.page = page
      syncAndFetch()
    },
    setSearch(search: string) {
      refs.filter.search = search
      refs.pagination.page = 1
      syncAndFetch()
    },
    setFilter(key: string, value: string | number | boolean) {
      ;(refs.filter as Record<string, string | number | boolean>)[key] = value
      refs.pagination.page = 1
      syncAndFetch()
    },
    setSort(column: string, direction?: 'asc' | 'desc') {
      if (refs.sort.column === column && !direction) {
        refs.sort.direction = refs.sort.direction === 'asc' ? 'desc' : 'asc'
      } else {
        refs.sort.column = column
        refs.sort.direction = direction || 'desc'
      }
      syncAndFetch()
    },
    setTimeRange(range: TimeRange) {
      refs.timeRange.value = range
      syncAndFetch()
    },
  }
}

/** Build controller lifecycle methods. */
function buildLifecycleMethods(
  controller: DashboardDataController,
  section: () => DashboardSection | string,
  refs: DashboardRefs
) {
  return {
    async mutate(
      path: string,
      method: 'post' | 'delete' = 'post',
      body?: unknown
    ): Promise<unknown> {
      return controller.mutate(path, method, body)
    },
    refresh() {
      syncControllerParams(controller, section, refs)
      controller.fetch(true)
    },
    startRefresh() {
      controller.start()
    },
    stopRefresh() {
      controller.stop()
    },
  }
}

/** Set up watchers for section changes and refreshKey. */
function setupWatchers(
  controller: DashboardDataController,
  section: () => DashboardSection | string,
  refs: DashboardRefs,
  refreshKey: Ref<number> | WatchSource<number> | undefined
): void {
  watch(section, () => {
    refs.pagination.page = 1
    for (const key of Object.keys(refs.filter)) {
      if (key === 'search') {
        refs.filter.search = ''
      } else {
        delete (refs.filter as Record<string, unknown>)[key]
      }
    }
    refs.sort.column = ''
    refs.data.value = null
    controller.setSection(section() as DashboardSection)
    syncControllerParams(controller, section, refs)
  })

  if (refreshKey) {
    watch(refreshKey, () => {
      syncControllerParams(controller, section, refs)
      controller.handleRefreshSignal()
    })
  }
}

/** Create the reactive state refs for the composable. */
function createReactiveState(perPage: number): DashboardRefs {
  return {
    data: ref<unknown>(null),
    loading: ref(false),
    error: ref<Error | null>(null),
    isUnauthorized: ref(false),
    timeRange: ref<TimeRange>('1h'),
    pagination: reactive<PaginationState>({ page: 1, perPage, total: 0, totalPages: 1 }),
    filter: reactive<{ search: string; [key: string]: string | number | boolean }>({ search: '' }),
    sort: reactive<{ column: string; direction: 'asc' | 'desc' }>({
      column: '',
      direction: 'desc',
    }),
  }
}

/** Build the return value of the composable. */
function buildReturnValue(
  refs: DashboardRefs,
  navMethods: ReturnType<typeof buildNavigationMethods>,
  lifecycleMethods: ReturnType<typeof buildLifecycleMethods>,
  apiHelpers: Record<string, unknown>
) {
  return {
    data: refs.data,
    loading: refs.loading,
    error: refs.error,
    isUnauthorized: refs.isUnauthorized,
    pagination: refs.pagination,
    filter: refs.filter,
    sort: refs.sort,
    timeRange: refs.timeRange,
    ...navMethods,
    ...lifecycleMethods,
    ...apiHelpers,
  }
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

  const refs = createReactiveState(perPage)
  const controller = new DashboardDataController({
    baseUrl,
    endpoint: dashboardEndpoint,
    authToken,
    section: section() as DashboardSection,
    perPage,
    callbacks: buildCallbacks(refs),
  })

  const api = controller.getApi()
  const syncAndFetch = () => {
    syncControllerParams(controller, section, refs)
    controller.fetch(false)
  }

  const navMethods = buildNavigationMethods(refs, syncAndFetch)
  const lifecycleMethods = buildLifecycleMethods(controller, section, refs)
  const apiHelpers = {
    ...createChartHelper(api, refs.isUnauthorized),
    ...createReadApiHelpers(api),
    ...createMutationApiHelpers(api),
  }

  setupWatchers(controller, section, refs, refreshKey)
  onMounted(() => {
    syncControllerParams(controller, section, refs)
    controller.start()
  })
  onUnmounted(() => {
    controller.stop()
  })

  return buildReturnValue(refs, navMethods, lifecycleMethods, apiHelpers)
}

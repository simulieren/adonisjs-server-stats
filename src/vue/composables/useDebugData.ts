/**
 * Vue composable for fetching debug panel data.
 *
 * Thin wrapper around {@link DebugDataController} — bridges the
 * controller's callbacks into Vue reactive refs so consumers get
 * the same interface as before.
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'

import { DebugDataController } from '../../core/debug-data-controller.js'

import type { DebugTab } from '../../core/index.js'

/** Tabs that live on the dashboard API, not the debug endpoint. */
const DASHBOARD_TABS = new Set(['cache', 'jobs', 'config'])

export interface UseDebugDataOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Debug endpoint base path. */
  debugEndpoint?: string
  /** Dashboard API base path (used for cache/jobs tabs). */
  dashboardEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
  /** Auto-refresh interval in ms. */
  refreshInterval?: number
}

/** Build callbacks that bridge DebugDataController events to Vue refs. */
function buildCallbacks(refs: {
  data: ReturnType<typeof ref<unknown>>
  loading: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<Error | null>>
  isUnauthorized: ReturnType<typeof ref<boolean>>
}) {
  return {
    onData: (d: unknown) => {
      refs.data.value = d
    },
    onLoading: (l: boolean) => {
      refs.loading.value = l
    },
    onError: (e: Error | null) => {
      refs.error.value = e
    },
    onUnauthorized: () => {
      refs.isUnauthorized.value = true
    },
  }
}

/** Internal refs shared across the composable helpers. */
interface DebugRefs {
  data: ReturnType<typeof ref<unknown>>
  loading: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<Error | null>>
  isUnauthorized: ReturnType<typeof ref<boolean>>
}

/** Manages the primary and optional dashboard controllers. */
class ControllerManager {
  private controller: DebugDataController
  private dashboardController: DebugDataController | null = null
  private dashboardEndpoint: string | undefined

  constructor(
    private refs: DebugRefs,
    private config: { baseUrl: string; authToken?: string; refreshInterval?: number },
    debugEndpoint: string,
    dashboardEndpoint?: string
  ) {
    this.dashboardEndpoint = dashboardEndpoint
    this.controller = new DebugDataController({
      ...config,
      endpoint: debugEndpoint,
      ...buildCallbacks(refs),
    })
  }

  private getDashboardController(): DebugDataController {
    if (!this.dashboardController && this.dashboardEndpoint) {
      this.dashboardController = new DebugDataController({
        ...this.config,
        endpoint: this.dashboardEndpoint,
        ...buildCallbacks(this.refs),
      })
    }
    return this.dashboardController!
  }

  startForTab(tab: () => DebugTab | string) {
    const currentTab = tab()
    if (!currentTab || currentTab.startsWith('custom-')) return
    if (DASHBOARD_TABS.has(currentTab) && this.dashboardEndpoint) {
      this.controller.stop()
      this.getDashboardController().start(currentTab)
    } else {
      this.dashboardController?.stop()
      this.controller.start(currentTab)
    }
  }

  stopAll() {
    this.controller.stop()
    this.dashboardController?.stop()
  }

  refresh(tab: () => DebugTab | string) {
    const t = tab()
    if (DASHBOARD_TABS.has(t) && this.dashboardEndpoint && this.dashboardController)
      this.dashboardController.refresh()
    else this.controller.refresh()
  }

  fetchCustomPane(endpoint: string, fetchOnce: boolean = false) {
    return this.controller.fetchCustomPane(endpoint, fetchOnce)
  }
}

export function useDebugData(tab: () => DebugTab | string, options: UseDebugDataOptions = {}) {
  const {
    baseUrl = '',
    debugEndpoint = '/admin/api/debug',
    dashboardEndpoint,
    authToken,
    refreshInterval,
  } = options

  const data = ref<unknown>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)
  const refs: DebugRefs = { data, loading, error, isUnauthorized }

  const mgr = new ControllerManager(
    refs,
    { baseUrl, authToken, refreshInterval },
    debugEndpoint,
    dashboardEndpoint
  )

  watch(tab, () => {
    data.value = null
    mgr.startForTab(tab)
  })
  onMounted(() => mgr.startForTab(tab))
  onUnmounted(() => mgr.stopAll())

  return {
    data,
    loading,
    error,
    isUnauthorized,
    refresh: () => mgr.refresh(tab),
    clear: () => {
      data.value = null
    },
    fetchCustomPane: (endpoint: string, fetchOnce: boolean = false) =>
      mgr.fetchCustomPane(endpoint, fetchOnce),
    startRefresh: () => mgr.startForTab(tab),
    stopRefresh: () => mgr.stopAll(),
  }
}

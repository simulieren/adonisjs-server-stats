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
    onData: (d: unknown) => { refs.data.value = d },
    onLoading: (l: boolean) => { refs.loading.value = l },
    onError: (e: Error | null) => { refs.error.value = e },
    onUnauthorized: () => { refs.isUnauthorized.value = true },
  }
}

export function useDebugData(tab: () => DebugTab | string, options: UseDebugDataOptions = {}) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', dashboardEndpoint, authToken, refreshInterval } = options

  const data = ref<unknown>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)
  const refs = { data, loading, error, isUnauthorized }

  const controller = new DebugDataController({ baseUrl, endpoint: debugEndpoint, authToken, refreshInterval, ...buildCallbacks(refs) })
  let dashboardController: DebugDataController | null = null

  function getDashboardController(): DebugDataController {
    if (!dashboardController && dashboardEndpoint) {
      dashboardController = new DebugDataController({ baseUrl, endpoint: dashboardEndpoint, authToken, refreshInterval, ...buildCallbacks(refs) })
    }
    return dashboardController!
  }

  function startForTab() {
    const currentTab = tab()
    if (!currentTab || currentTab.startsWith('custom-')) return
    if (DASHBOARD_TABS.has(currentTab) && dashboardEndpoint) {
      controller.stop()
      getDashboardController().start(currentTab)
    } else {
      dashboardController?.stop()
      controller.start(currentTab)
    }
  }

  function stopAll() { controller.stop(); dashboardController?.stop() }

  watch(tab, () => { data.value = null; startForTab() })
  onMounted(() => startForTab())
  onUnmounted(() => stopAll())

  return {
    data, loading, error, isUnauthorized,
    refresh: () => {
      const t = tab()
      if (DASHBOARD_TABS.has(t) && dashboardEndpoint && dashboardController) dashboardController.refresh()
      else controller.refresh()
    },
    clear: () => { data.value = null },
    fetchCustomPane: (endpoint: string, fetchOnce: boolean = false) => controller.fetchCustomPane(endpoint, fetchOnce),
    startRefresh: () => startForTab(),
    stopRefresh: () => stopAll(),
  }
}

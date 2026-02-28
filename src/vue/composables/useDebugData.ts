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

  const controller = new DebugDataController({
    baseUrl,
    endpoint: debugEndpoint,
    authToken,
    refreshInterval,
    onData: (d) => { data.value = d },
    onLoading: (l) => { loading.value = l },
    onError: (e) => { error.value = e },
    onUnauthorized: () => { isUnauthorized.value = true },
  })

  // For DASHBOARD_TABS we need a second controller that targets the
  // dashboard endpoint.  Created lazily only when needed.
  let dashboardController: DebugDataController | null = null

  function getDashboardController(): DebugDataController {
    if (!dashboardController && dashboardEndpoint) {
      dashboardController = new DebugDataController({
        baseUrl,
        endpoint: dashboardEndpoint,
        authToken,
        refreshInterval,
        onData: (d) => { data.value = d },
        onLoading: (l) => { loading.value = l },
        onError: (e) => { error.value = e },
        onUnauthorized: () => { isUnauthorized.value = true },
      })
    }
    return dashboardController!
  }

  /** Resolve which controller + tab path to use for the current tab. */
  function startForTab() {
    const currentTab = tab()
    if (!currentTab) return

    // Custom tabs handle their own data fetching via CustomPaneTab
    if (currentTab.startsWith('custom-')) return

    // Route dashboard-specific tabs to the dashboard endpoint controller
    if (DASHBOARD_TABS.has(currentTab) && dashboardEndpoint) {
      const dc = getDashboardController()
      // Use getDebugTabPath for the path suffix but the dashboard controller for the base
      controller.stop()
      dc.start(currentTab)
    } else {
      dashboardController?.stop()
      controller.start(currentTab)
    }
  }

  function stopAll() {
    controller.stop()
    dashboardController?.stop()
  }

  /**
   * Fetch data for a custom pane endpoint.
   */
  async function fetchCustomPane(endpoint: string, fetchOnce: boolean = false) {
    await controller.fetchCustomPane(endpoint, fetchOnce)
  }

  function startRefresh() {
    startForTab()
  }

  function stopRefresh() {
    stopAll()
  }

  function refresh() {
    const currentTab = tab()
    if (DASHBOARD_TABS.has(currentTab) && dashboardEndpoint && dashboardController) {
      dashboardController.refresh()
    } else {
      controller.refresh()
    }
  }

  function clear() {
    data.value = null
  }

  // Watch for tab changes
  watch(tab, () => {
    clear()
    startForTab()
  })

  onMounted(() => {
    startRefresh()
  })

  onUnmounted(() => {
    stopAll()
  })

  return {
    data,
    loading,
    error,
    isUnauthorized,
    refresh,
    clear,
    fetchCustomPane,
    startRefresh,
    stopRefresh,
  }
}

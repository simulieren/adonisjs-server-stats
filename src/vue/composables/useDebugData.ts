/**
 * Vue composable for fetching debug panel data.
 *
 * Fetches data for the active tab with auto-refresh every 3s.
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'

import { ApiClient, UnauthorizedError, getDebugTabPath } from '../../core/index.js'

import type { DebugTab } from '../../core/index.js'

export interface UseDebugDataOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Debug endpoint base path. */
  debugEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
  /** Auto-refresh interval in ms. */
  refreshInterval?: number
}

export function useDebugData(tab: () => DebugTab | string, options: UseDebugDataOptions = {}) {
  const {
    baseUrl = '',
    debugEndpoint = '/admin/api/debug',
    authToken,
    refreshInterval = 3000,
  } = options

  const data = ref<unknown>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)

  const client = new ApiClient({ baseUrl, authToken })
  let timer: ReturnType<typeof setInterval> | null = null
  const fetchOnceCache = new Set<string>()

  async function fetchData() {
    const currentTab = tab()
    if (!currentTab) return

    const path = getDebugTabPath(currentTab)

    loading.value = true
    try {
      const result = await client.fetch(`${debugEndpoint}${path}`)
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
   * Fetch data for a custom pane endpoint.
   */
  async function fetchCustomPane(endpoint: string, fetchOnce: boolean = false) {
    if (fetchOnce && fetchOnceCache.has(endpoint)) return

    loading.value = true
    try {
      const result = await client.fetch(endpoint)
      data.value = result
      error.value = null
      if (fetchOnce) fetchOnceCache.add(endpoint)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
      } else {
        error.value = err as Error
      }
    } finally {
      loading.value = false
    }
  }

  function startRefresh() {
    stopRefresh()
    fetchData()
    timer = setInterval(fetchData, refreshInterval)
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

  function clear() {
    data.value = null
  }

  // Watch for tab changes
  watch(tab, () => {
    clear()
    if (timer) {
      startRefresh()
    } else {
      fetchData()
    }
  })

  onMounted(() => {
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
    refresh,
    clear,
    fetchCustomPane,
    startRefresh,
    stopRefresh,
  }
}

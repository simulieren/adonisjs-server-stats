/**
 * Vue composable for SSE subscription and stats polling.
 *
 * Connects to Transmit SSE for real-time stats updates,
 * falling back to HTTP polling. Maintains a history buffer
 * of the last 60 values per metric for sparkline rendering.
 */

import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'

import {
  ApiClient,
  subscribeToChannel,
  UnauthorizedError,
  STALE_MS,
  createHistoryBuffer,
} from '../../core/index.js'

import type { ServerStats } from '../../core/index.js'

export interface UseServerStatsOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Stats endpoint path. */
  endpoint?: string
  /** Transmit channel name. */
  channelName?: string
  /** Auth token for API requests. */
  authToken?: string
  /** Poll interval in milliseconds. */
  pollInterval?: number
}

export function useServerStats(options: UseServerStatsOptions = {}) {
  const {
    baseUrl = '',
    endpoint = '/admin/api/server-stats',
    channelName = 'admin/server-stats',
    authToken,
    pollInterval = 3000,
  } = options

  const stats = ref<ServerStats | null>(null)
  const historyBuffer = createHistoryBuffer()
  const history = reactive<Record<string, number[]>>({})
  const isConnected = ref(false)
  const isStale = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)

  const client = new ApiClient({ baseUrl, authToken })
  let sseHandle: { unsubscribe: () => void } | null = null
  const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let lastSuccess = 0
  const sseActive = ref(false)

  function processStats(newStats: ServerStats) {
    stats.value = newStats
    error.value = null
    lastSuccess = Date.now()
    isStale.value = false

    historyBuffer.push(newStats)

    // Sync the reactive history object with the buffer
    const all = historyBuffer.getAll()
    for (const key of Object.keys(all)) {
      history[key] = all[key]
    }
  }

  async function poll() {
    if (isUnauthorized.value) return
    try {
      const data = await client.fetch<ServerStats>(endpoint)
      processStats(data)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
        error.value = err as Error
        stopPolling()
      }
      // Network errors just mean stale data
    }
  }

  function startPolling() {
    poll()
    pollTimer.value = setInterval(poll, pollInterval)
  }

  function stopPolling() {
    if (pollTimer.value) {
      clearInterval(pollTimer.value)
      pollTimer.value = null
    }
  }

  function checkStale() {
    if (lastSuccess > 0 && Date.now() - lastSuccess > STALE_MS) {
      isStale.value = true
    }
  }

  const connectionMode = computed<'live' | 'polling' | 'disconnected'>(() => {
    if (isUnauthorized.value) return 'disconnected'
    if (sseActive.value) return 'live'
    if (pollTimer.value) return 'polling'
    return 'disconnected'
  })

  onMounted(() => {
    if (isUnauthorized.value) return

    // Try SSE first via Transmit
    let usePolling = false

    try {
      const sub = subscribeToChannel({
        baseUrl,
        channelName,
        authToken,
        onMessage: (data) => {
          if (data && typeof data === 'object' && 'timestamp' in data) {
            processStats(data as ServerStats)
          }
        },
        onConnect: () => {
          sseActive.value = true
          isConnected.value = true
          // Stop polling — SSE is delivering data
          stopPolling()
        },
        onDisconnect: () => {
          sseActive.value = false
          isConnected.value = false
          // Fall back to polling
          if (!pollTimer.value && !isUnauthorized.value) {
            pollTimer.value = setInterval(poll, pollInterval)
          }
        },
        onError: () => {
          usePolling = true
        },
      })

      sseHandle = sub
    } catch {
      usePolling = true
    }

    // Always do an initial poll to get data fast
    poll()

    // Start polling as fallback (will be stopped if SSE connects)
    if (usePolling || !sseHandle) {
      pollTimer.value = setInterval(poll, pollInterval)
    } else {
      // Give SSE 3 seconds to connect, then start polling as backup
      const fallbackTimer = setTimeout(() => {
        if (!isConnected.value && !pollTimer.value) {
          pollTimer.value = setInterval(poll, pollInterval)
        }
      }, 3000)

      // Store the fallback timer for cleanup
      const originalUnsubscribe = sseHandle.unsubscribe
      sseHandle.unsubscribe = () => {
        clearTimeout(fallbackTimer)
        originalUnsubscribe()
      }
    }

    // Stale detection
    staleTimer = setInterval(checkStale, 2000)
  })

  onUnmounted(() => {
    sseHandle?.unsubscribe()
    sseHandle = null
    stopPolling()
    if (staleTimer) {
      clearInterval(staleTimer)
      staleTimer = null
    }
  })

  return {
    stats,
    history,
    isConnected,
    isStale,
    isUnauthorized,
    error,
    connectionMode,
  }
}

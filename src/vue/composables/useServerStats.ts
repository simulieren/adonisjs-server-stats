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
  createTransmitSubscription,
  UnauthorizedError,
  STALE_MS,
  createHistoryBuffer,
} from '../../core/index.js'
import type { ServerStats, TransmitSubscriptionHandle } from '../../core/index.js'

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
  let subscription: TransmitSubscriptionHandle | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let lastSuccess = 0
  let sseActive = false

  function handleStatsUpdate(newStats: ServerStats) {
    stats.value = newStats
    lastSuccess = Date.now()
    isStale.value = false
    isConnected.value = true
    error.value = null

    historyBuffer.push(newStats)

    // Sync the reactive history object with the buffer
    const all = historyBuffer.getAll()
    for (const key of Object.keys(all)) {
      history[key] = all[key]
    }
  }

  async function fetchStats() {
    try {
      const data = await client.fetch<ServerStats>(endpoint)
      handleStatsUpdate(data)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        isUnauthorized.value = true
        stopPolling()
      } else {
        error.value = err as Error
      }
    }
  }

  function startPolling() {
    fetchStats()
    pollTimer = setInterval(fetchStats, pollInterval)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function checkStale() {
    if (lastSuccess > 0 && Date.now() - lastSuccess > STALE_MS) {
      isStale.value = true
    }
  }

  const connectionMode = computed<'live' | 'polling' | 'disconnected'>(() => {
    if (isUnauthorized.value) return 'disconnected'
    if (sseActive) return 'live'
    if (pollTimer) return 'polling'
    return 'disconnected'
  })

  onMounted(() => {
    // Try SSE first via Transmit
    subscription = createTransmitSubscription({
      baseUrl,
      channelName,
      authToken,
      onMessage: (data) => {
        sseActive = true
        handleStatsUpdate(data as ServerStats)
      },
      onError: () => {
        // Fallback to polling if SSE fails
        sseActive = false
        if (!pollTimer) {
          startPolling()
        }
      },
    })

    // Start SSE subscription
    subscription.subscribe().catch(() => {
      // If SSE subscription fails, start polling
      sseActive = false
      startPolling()
    })

    // Also start polling as fallback — will be stopped if SSE works
    startPolling()

    // Stale detection
    staleTimer = setInterval(checkStale, 2000)
  })

  onUnmounted(() => {
    subscription?.unsubscribe()
    subscription = null
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

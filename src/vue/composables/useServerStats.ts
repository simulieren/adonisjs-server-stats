/**
 * Vue composable for SSE subscription and stats polling.
 *
 * Connects to Transmit SSE for real-time stats updates,
 * falling back to HTTP polling. Maintains a history buffer
 * of the last 60 values per metric for sparkline rendering.
 */

import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'

import { ServerStatsController } from '../../core/server-stats-controller.js'

import type { ServerStats } from '../../core/index.js'
import type { ConnectionMode } from '../../core/server-stats-controller.js'

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
  const history = reactive<Record<string, number[]>>({})
  const isConnected = ref(false)
  const isStale = ref(false)
  const error = ref<Error | null>(null)
  const isUnauthorized = ref(false)
  const sseActive = ref(false)
  const pollActive = ref(false)

  let controller: ServerStatsController | null = null

  const connectionMode = computed<ConnectionMode>(() => {
    if (isUnauthorized.value) return 'disconnected'
    if (sseActive.value) return 'live'
    if (pollActive.value) return 'polling'
    return 'disconnected'
  })

  onMounted(() => {
    if (isUnauthorized.value) return

    controller = new ServerStatsController({
      baseUrl,
      endpoint,
      channelName,
      authToken,
      pollInterval,
      onStatsUpdate: (data) => {
        stats.value = data
      },
      onConnectionChange: (connected) => {
        isConnected.value = connected
      },
      onStaleChange: (stale) => {
        isStale.value = stale
      },
      onError: (err) => {
        error.value = err
      },
      onUnauthorizedChange: (val) => {
        isUnauthorized.value = val
      },
      onHistoryChange: (all) => {
        for (const key of Object.keys(all)) {
          history[key] = all[key]
        }
      },
      onSseActiveChange: (active) => {
        sseActive.value = active
      },
      onPollActiveChange: (active) => {
        pollActive.value = active
      },
    })

    controller.start()
  })

  onUnmounted(() => {
    controller?.stop()
    controller = null
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

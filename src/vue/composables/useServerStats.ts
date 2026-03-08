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

/** Create the controller callbacks that bridge to Vue reactive refs. */
function createControllerCallbacks(refs: {
  stats: ReturnType<typeof ref<ServerStats | null>>
  history: Record<string, number[]>
  isConnected: ReturnType<typeof ref<boolean>>
  isStale: ReturnType<typeof ref<boolean>>
  error: ReturnType<typeof ref<Error | null>>
  isUnauthorized: ReturnType<typeof ref<boolean>>
  sseActive: ReturnType<typeof ref<boolean>>
  pollActive: ReturnType<typeof ref<boolean>>
}) {
  return {
    onStatsUpdate: (data: ServerStats) => { refs.stats.value = data },
    onConnectionChange: (connected: boolean) => { refs.isConnected.value = connected },
    onStaleChange: (stale: boolean) => { refs.isStale.value = stale },
    onError: (err: Error | null) => { refs.error.value = err },
    onUnauthorizedChange: (val: boolean) => { refs.isUnauthorized.value = val },
    onHistoryChange: (all: Record<string, number[]>) => {
      for (const key of Object.keys(all)) { refs.history[key] = all[key] }
    },
    onSseActiveChange: (active: boolean) => { refs.sseActive.value = active },
    onPollActiveChange: (active: boolean) => { refs.pollActive.value = active },
  }
}

export function useServerStats(options: UseServerStatsOptions = {}) {
  const { baseUrl = '', endpoint = '/admin/api/server-stats', channelName = 'admin/server-stats', authToken, pollInterval = 3000 } = options

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
    const callbacks = createControllerCallbacks({ stats, history, isConnected, isStale, error, isUnauthorized, sseActive, pollActive })
    controller = new ServerStatsController({ baseUrl, endpoint, channelName, authToken, pollInterval, ...callbacks })
    controller.start()
  })

  onUnmounted(() => { controller?.stop(); controller = null })

  return { stats, history, isConnected, isStale, isUnauthorized, error, connectionMode }
}

import { useState, useEffect, useRef, useCallback } from 'react'

import { ServerStatsController } from '../../core/server-stats-controller.js'

import type { ServerStats, StatsBarProps } from '../../core/types.js'

export interface StatsHistory {
  [key: string]: number[]
}

/**
 * React hook for SSE subscription to server stats.
 *
 * Connects to Transmit SSE for real-time updates, maintains a history
 * of the last 60 values per metric, and falls back to polling if SSE
 * is unavailable.
 */
export function useServerStats(options: StatsBarProps = {}) {
  const {
    baseUrl = '',
    endpoint = '/admin/api/server-stats',
    channelName = 'admin/server-stats',
    authToken,
    pollInterval = 3000,
  } = options

  const [stats, setStats] = useState<ServerStats | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  const controllerRef = useRef<ServerStatsController | null>(null)

  useEffect(() => {
    if (unauthorized) return

    const controller = new ServerStatsController({
      baseUrl,
      endpoint,
      channelName,
      authToken,
      pollInterval,
      onStatsUpdate: (data) => setStats(data),
      onConnectionChange: (connected) => setIsConnected(connected),
      onStaleChange: (stale) => setIsStale(stale),
      onError: (err) => setError(err),
      onUnauthorizedChange: (val) => setUnauthorized(val),
    })

    controllerRef.current = controller
    controller.start()

    return () => {
      controller.stop()
      controllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, channelName, authToken, pollInterval, unauthorized])

  const getHistory = useCallback((key: string): number[] => {
    return controllerRef.current?.getHistory(key) ?? []
  }, [])

  return {
    stats,
    history: controllerRef.current?.getAllHistory() ?? {},
    getHistory,
    isConnected,
    isStale,
    error,
    unauthorized,
  } as const
}

import { useState, useEffect, useRef, useCallback } from 'react'

import { ApiClient, UnauthorizedError } from '../../core/api-client.js'
import { createHistoryBuffer } from '../../core/history-buffer.js'
import { STALE_MS } from '../../core/metrics.js'
import { subscribeToChannel } from '../../core/transmit-adapter.js'

import type { HistoryBuffer } from '../../core/history-buffer.js'
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

  const historyBufferRef = useRef<HistoryBuffer>(createHistoryBuffer())
  const lastSuccessRef = useRef<number>(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sseRef = useRef<{ unsubscribe: () => void } | null>(null)
  const clientRef = useRef<ApiClient | null>(null)

  /** Process incoming stats data. */
  const processStats = useCallback((data: ServerStats) => {
    setStats(data)
    setError(null)
    lastSuccessRef.current = Date.now()
    setIsStale(false)

    historyBufferRef.current.push(data)
  }, [])

  /** Poll the HTTP endpoint. */
  const poll = useCallback(async () => {
    if (unauthorized) return
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken })
    }

    try {
      const data = await clientRef.current.get<ServerStats>(endpoint)
      processStats(data)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setUnauthorized(true)
        setError(err)
      }
      // Network errors just mean stale data
    }
  }, [baseUrl, endpoint, authToken, unauthorized, processStats])

  useEffect(() => {
    if (unauthorized) return

    // Try SSE first
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
          setIsConnected(true)
          // Stop polling if SSE is connected
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
        },
        onDisconnect: () => {
          setIsConnected(false)
          // Fall back to polling
          if (!pollTimerRef.current && !unauthorized) {
            pollTimerRef.current = setInterval(poll, pollInterval)
          }
        },
        onError: () => {
          // SSE failed, fall back to polling
          usePolling = true
        },
      })

      sseRef.current = sub
    } catch {
      usePolling = true
    }

    // Always do an initial poll to get data fast
    poll()

    // Start polling as fallback (will be stopped if SSE connects)
    if (usePolling || !sseRef.current) {
      pollTimerRef.current = setInterval(poll, pollInterval)
    } else {
      // Give SSE 3 seconds to connect, then start polling as backup
      const fallbackTimer = setTimeout(() => {
        if (!isConnected && !pollTimerRef.current) {
          pollTimerRef.current = setInterval(poll, pollInterval)
        }
      }, 3000)

      // Store the fallback timer for cleanup
      const originalUnsubscribe = sseRef.current?.unsubscribe
      if (sseRef.current) {
        sseRef.current.unsubscribe = () => {
          clearTimeout(fallbackTimer)
          originalUnsubscribe?.()
        }
      }
    }

    // Stale detection
    staleTimerRef.current = setInterval(() => {
      if (lastSuccessRef.current > 0 && Date.now() - lastSuccessRef.current > STALE_MS) {
        setIsStale(true)
      }
    }, 2000)

    return () => {
      sseRef.current?.unsubscribe()
      sseRef.current = null
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      if (staleTimerRef.current) {
        clearInterval(staleTimerRef.current)
        staleTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, channelName, authToken, pollInterval, unauthorized])

  const getHistory = useCallback((key: string): number[] => {
    return historyBufferRef.current.get(key)
  }, [])

  return {
    stats,
    history: historyBufferRef.current.getAll(),
    getHistory,
    isConnected,
    isStale,
    error,
    unauthorized,
  } as const
}

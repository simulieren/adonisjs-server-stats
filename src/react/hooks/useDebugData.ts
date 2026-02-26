import { useState, useEffect, useRef, useCallback } from 'react'
import type { DebugTab, DebugPanelProps } from '../../core/types.js'
import { ApiClient, UnauthorizedError } from '../../core/api-client.js'
import { getDebugTabPath } from '../../core/routes.js'

const REFRESH_INTERVAL = 3000

/**
 * React hook for fetching debug panel data.
 *
 * Fetches data for the active tab from the debug endpoint,
 * auto-refreshes every 3 seconds while the tab is active.
 */
export function useDebugData<T = any>(
  tab: DebugTab,
  options: DebugPanelProps = {}
) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options

  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<ApiClient | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchOnceCache = useRef<Record<string, any>>({})

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken })
    }
    return clientRef.current
  }, [baseUrl, authToken])

  const fetchData = useCallback(async () => {
    // Check cache for fetchOnce tabs (like routes)
    if (fetchOnceCache.current[tab]) {
      setData(fetchOnceCache.current[tab])
      setIsLoading(false)
      return
    }

    try {
      const client = getClient()
      const endpoint = `${debugEndpoint}${getDebugTabPath(tab)}`
      const result = await client.get<T>(endpoint)
      setData(result)
      setError(null)
      setIsLoading(false)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError(err)
        setIsLoading(false)
        // Stop refreshing on auth error
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        return
      }
      setError(err instanceof Error ? err : new Error(String(err)))
      setIsLoading(false)
    }
  }, [tab, debugEndpoint, getClient])

  useEffect(() => {
    // Reset state on tab change
    setIsLoading(true)
    setError(null)

    // Initial fetch
    fetchData()

    // Auto-refresh
    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [tab, fetchData])

  const refresh = useCallback(() => {
    fetchData()
  }, [fetchData])

  const clearData = useCallback(() => {
    setData(null)
  }, [])

  /** Cache data for fetchOnce tabs. */
  const cacheForTab = useCallback(
    (tabName: string, tabData: any) => {
      fetchOnceCache.current[tabName] = tabData
    },
    []
  )

  return { data, isLoading, error, refresh, clearData, cacheForTab } as const
}

import { useState, useEffect, useRef, useCallback } from 'react'
import type { DashboardSection, DashboardHookOptions, PaginatedResponse } from '../../core/types.js'
import { ApiClient, UnauthorizedError } from '../../core/api-client.js'
import { buildQueryParams } from '../../core/pagination.js'
import { DashboardApi } from '../../core/dashboard-api.js'
import { OVERVIEW_REFRESH_MS, SECTION_REFRESH_MS } from '../../core/constants.js'

/**
 * React hook for fetching dashboard section data.
 *
 * Supports pagination, search, sort, filters, and time range.
 * Auto-refreshes periodically while active.
 */
export function useDashboardData<T = any>(
  section: DashboardSection,
  options: DashboardHookOptions = {}
) {
  const {
    baseUrl = '',
    dashboardEndpoint = '/__stats/api',
    authToken,
    page = 1,
    perPage = 50,
    search,
    sort,
    sortDir,
    filters,
    timeRange,
  } = options

  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<PaginatedResponse<any>['meta'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<ApiClient | null>(null)
  const apiRef = useRef<DashboardApi | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken })
    }
    return clientRef.current
  }, [baseUrl, authToken])

  const getApi = useCallback(() => {
    if (!apiRef.current) {
      apiRef.current = new DashboardApi(getClient(), dashboardEndpoint)
    }
    return apiRef.current
  }, [getClient, dashboardEndpoint])

  const fetchData = useCallback(async () => {
    try {
      const api = getApi()
      const params = buildQueryParams({
        page,
        perPage,
        search,
        sort,
        sortDir,
        filters,
        timeRange,
      })

      const result = await api.fetchSection(section, params || undefined)

      // Handle both paginated and non-paginated responses
      if (result && result.data !== undefined && result.meta !== undefined) {
        setData(result.data as T)
        setMeta(result.meta)
      } else {
        setData(result as T)
        setMeta(null)
      }
      setError(null)
      setIsLoading(false)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError(err)
        setIsLoading(false)
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        return
      }
      setError(err instanceof Error ? err : new Error(String(err)))
      setIsLoading(false)
    }
  }, [section, getApi, page, perPage, search, sort, sortDir, filters, timeRange])

  useEffect(() => {
    setIsLoading(true)
    setError(null)

    fetchData()

    // Auto-refresh: overview every 5s, other sections every 10s
    const interval = section === 'overview' ? OVERVIEW_REFRESH_MS : SECTION_REFRESH_MS
    timerRef.current = setInterval(fetchData, interval)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [section, fetchData])

  const refresh = useCallback(() => {
    fetchData()
  }, [fetchData])

  /** Execute a mutation (POST/DELETE) against the dashboard API. */
  const mutate = useCallback(
    async (path: string, method: 'post' | 'delete' = 'post', body?: any) => {
      const client = getClient()
      const url = `${dashboardEndpoint}/${path}`
      try {
        const result =
          method === 'post' ? await client.post(url, body) : await client.delete(url)
        // Refresh after mutation
        await fetchData()
        return result
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
    [dashboardEndpoint, getClient, fetchData]
  )

  return { data, meta, isLoading, error, refresh, mutate } as const
}

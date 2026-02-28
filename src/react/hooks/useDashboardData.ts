import { useState, useEffect, useRef, useCallback } from 'react'

import { ApiClient, UnauthorizedError } from '../../core/api-client.js'
import { OVERVIEW_REFRESH_MS, SECTION_REFRESH_MS } from '../../core/constants.js'
import { DashboardApi } from '../../core/dashboard-api.js'
import { buildQueryParams } from '../../core/pagination.js'

import type { DashboardSection, DashboardHookOptions, PaginatedResponse } from '../../core/types.js'

/**
 * React hook for fetching dashboard section data.
 *
 * Supports pagination, search, sort, filters, and time range.
 * Auto-refreshes periodically while active.
 *
 * Distinguishes between "initial load" (first mount, section change) and
 * "silent refresh" (auto-poll, refreshKey change) to avoid UI flickering.
 */
export function useDashboardData<T = unknown>(
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
    refreshKey,
  } = options

  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<PaginatedResponse<unknown>['meta'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<ApiClient | null>(null)
  const apiRef = useRef<DashboardApi | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Track previous section to detect section changes vs refreshes */
  const prevSectionRef = useRef<DashboardSection>(section)
  /** Track whether we have successfully fetched data at least once */
  const hasFetchedRef = useRef(false)

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

  /**
   * Core fetch logic. When `silent` is true, errors are swallowed
   * (keeping stale data visible) and loading state is not modified.
   */
  const doFetch = useCallback(
    async (silent: boolean) => {
      try {
        const api = getApi()
        const sortParam = sort
          ? sort.replace(/[A-Z]/g, (c: string) => '_' + c.toLowerCase())
          : sort
        const params = buildQueryParams({
          page,
          perPage,
          search,
          sort: sortParam,
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
        hasFetchedRef.current = true
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

        // On silent refresh failures, keep showing stale data
        if (!silent) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setIsLoading(false)
        }
      }
    },
    [section, getApi, page, perPage, search, sort, sortDir, filters, timeRange]
  )

  useEffect(() => {
    const sectionChanged = prevSectionRef.current !== section
    prevSectionRef.current = section

    // Determine if this is an initial load or a section change.
    // In those cases, show loading state and clear stale data.
    // Otherwise (auto-refresh interval restart, refreshKey change),
    // fetch silently without flashing loading UI.
    const isInitialOrSectionChange = sectionChanged || !hasFetchedRef.current

    if (isInitialOrSectionChange) {
      setIsLoading(true)
      setError(null)
      setData(null)
      setMeta(null)
      hasFetchedRef.current = false
      doFetch(false)
    } else {
      // Silent refresh: don't clear data or show loading
      doFetch(true)
    }

    // Auto-refresh: overview every 5s, other sections every 10s
    const interval = section === 'overview' ? OVERVIEW_REFRESH_MS : SECTION_REFRESH_MS
    timerRef.current = setInterval(() => doFetch(true), interval)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    // refreshKey triggers a refetch when live data arrives
  }, [section, doFetch, refreshKey])

  const refresh = useCallback(() => {
    doFetch(true)
  }, [doFetch])

  /** Execute a mutation (POST/DELETE) against the dashboard API. */
  const mutate = useCallback(
    async (path: string, method: 'post' | 'delete' = 'post', body?: unknown) => {
      const client = getClient()
      const url = `${dashboardEndpoint}/${path}`
      try {
        const result = method === 'post' ? await client.post(url, body) : await client.delete(url)
        // Refresh after mutation
        await doFetch(true)
        return result
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
    [dashboardEndpoint, getClient, doFetch]
  )

  return { data, meta, isLoading, error, refresh, mutate, getApi } as const
}

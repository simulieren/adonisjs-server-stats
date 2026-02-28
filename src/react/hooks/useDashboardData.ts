import { useState, useEffect, useRef, useCallback } from 'react'

import { DashboardDataController } from '../../core/dashboard-data-controller.js'

import type { DashboardSection, DashboardHookOptions, PaginatedResponse } from '../../core/types.js'
import type { DashboardApi } from '../../core/dashboard-api.js'

/**
 * React hook for fetching dashboard section data.
 *
 * Thin wrapper around {@link DashboardDataController} that bridges
 * the controller's callbacks to React state. Supports pagination,
 * search, sort, filters, and time range via props.
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

  const controllerRef = useRef<DashboardDataController | null>(null)
  const prevSectionRef = useRef<DashboardSection>(section)
  const hasFetchedRef = useRef(false)

  // Lazily create the controller (stable across renders for the same baseUrl/auth)
  if (!controllerRef.current) {
    controllerRef.current = new DashboardDataController({
      baseUrl,
      endpoint: dashboardEndpoint,
      authToken,
      section,
      perPage,
      callbacks: {
        onData: (d) => setData(d as T | null),
        onPagination: (m) => setMeta(m),
        onLoading: (l) => setIsLoading(l),
        onError: (e) => setError(e),
        onUnauthorized: () => {
          /* error already set via onError */
        },
      },
    })
  }

  useEffect(() => {
    const ctrl = controllerRef.current!
    const sectionChanged = prevSectionRef.current !== section
    prevSectionRef.current = section

    // Push current params into the controller before fetching
    ctrl.configure({ page, perPage, search, sort, sortDir, filters, timeRange })

    const isInitialOrSectionChange = sectionChanged || !hasFetchedRef.current

    if (isInitialOrSectionChange) {
      if (sectionChanged) {
        ctrl.setSection(section)
      } else {
        ctrl.start()
      }
      hasFetchedRef.current = true
    } else {
      // Silent refresh: don't clear data or show loading
      ctrl.fetch(true)
    }

    return () => {
      ctrl.stop()
    }
    // refreshKey triggers a refetch when live data arrives
  }, [section, page, perPage, search, sort, sortDir, filters, timeRange, refreshKey])

  const refresh = useCallback(() => {
    controllerRef.current?.fetch(true)
  }, [])

  const mutate = useCallback(
    async (path: string, method: 'post' | 'delete' = 'post', body?: unknown) => {
      return controllerRef.current!.mutate(path, method, body)
    },
    []
  )

  const getApi = useCallback((): DashboardApi => {
    return controllerRef.current!.getApi()
  }, [])

  return { data, meta, isLoading, error, refresh, mutate, getApi } as const
}

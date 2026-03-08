import { useState, useEffect, useRef, useCallback } from 'react'

import { DashboardDataController } from '../../core/dashboard-data-controller.js'

import type { DashboardApi } from '../../core/dashboard-api.js'
import type { DashboardSection, DashboardHookOptions, PaginatedResponse } from '../../core/types.js'

/** Create a DashboardDataController wired to React state setters. */
function createController(
  section: DashboardSection,
  options: {
    baseUrl: string
    dashboardEndpoint: string
    authToken?: string
    perPage: number
    setData: (d: unknown) => void
    setMeta: (m: PaginatedResponse<unknown>['meta'] | null) => void
    setIsLoading: (l: boolean) => void
    setError: (e: Error | null) => void
  }
): DashboardDataController {
  return new DashboardDataController({
    baseUrl: options.baseUrl,
    endpoint: options.dashboardEndpoint,
    authToken: options.authToken,
    section,
    perPage: options.perPage,
    callbacks: {
      onData: (d) => options.setData(d),
      onPagination: (m) => options.setMeta(m),
      onLoading: (l) => options.setIsLoading(l),
      onError: (e) => options.setError(e),
      onUnauthorized: () => {
        /* error already set via onError */
      },
    },
  })
}

/** Context for syncing params to the controller. */
interface SyncContext {
  ctrl: DashboardDataController
  section: DashboardSection
  prevSection: DashboardSection
  hasFetched: boolean
}

/** Sync params and decide whether to do initial/section-change load or silent refresh. */
function syncAndFetch(ctx: SyncContext, params: DashboardHookOptions): boolean {
  ctx.ctrl.configure(params)
  const sectionChanged = ctx.prevSection !== ctx.section

  if (sectionChanged || !ctx.hasFetched) {
    if (sectionChanged) {
      ctx.ctrl.setSection(ctx.section)
    } else {
      ctx.ctrl.start()
    }
    return true
  }

  ctx.ctrl.fetch(true)
  return ctx.hasFetched
}

/** Initialize the React state hooks for dashboard data. */
function useDashboardState<T>() {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<PaginatedResponse<unknown>['meta'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  return { data, setData, meta, setMeta, isLoading, setIsLoading, error, setError }
}

/** Build the memoized action callbacks (refresh, mutate, getApi). */
function useDashboardActions(controllerRef: React.RefObject<DashboardDataController | null>) {
  const refresh = useCallback(() => {
    controllerRef.current?.fetch(true)
  }, [])
  const mutate = useCallback(
    async (path: string, method: 'post' | 'delete' = 'post', body?: unknown) => {
      return controllerRef.current!.mutate(path, method, body)
    },
    []
  )
  const getApi = useCallback((): DashboardApi => controllerRef.current!.getApi(), [])
  return { refresh, mutate, getApi }
}

/** Ensure the controller ref is initialized. */
function ensureController<T>(
  controllerRef: React.MutableRefObject<DashboardDataController | null>,
  section: DashboardSection,
  options: { baseUrl: string; dashboardEndpoint: string; authToken?: string; perPage: number },
  state: ReturnType<typeof useDashboardState<T>>
): void {
  if (controllerRef.current) return
  controllerRef.current = createController(section, {
    ...options,
    setData: (d) => state.setData(d as T | null),
    setMeta: state.setMeta,
    setIsLoading: state.setIsLoading,
    setError: state.setError,
  })
}

/** Destructure options with defaults. */
function parseOptions(options: DashboardHookOptions) {
  return {
    baseUrl: options.baseUrl ?? '',
    dashboardEndpoint: options.dashboardEndpoint ?? '/__stats/api',
    authToken: options.authToken,
    page: options.page ?? 1,
    perPage: options.perPage ?? 50,
    search: options.search,
    sort: options.sort,
    sortDir: options.sortDir,
    filters: options.filters,
    timeRange: options.timeRange,
    refreshKey: options.refreshKey,
  }
}

/**
 * React hook for fetching dashboard section data.
 *
 * Thin wrapper around {@link DashboardDataController} that bridges
 * the controller's callbacks to React state.
 */
export function useDashboardData<T = unknown>(
  section: DashboardSection,
  options: DashboardHookOptions = {}
) {
  const opts = parseOptions(options)
  const state = useDashboardState<T>()
  const controllerRef = useRef<DashboardDataController | null>(null)
  const prevSectionRef = useRef<DashboardSection>(section)
  const hasFetchedRef = useRef(false)

  ensureController(controllerRef, section, opts, state)

  useEffect(() => {
    const prev = prevSectionRef.current
    prevSectionRef.current = section
    hasFetchedRef.current = syncAndFetch(
      {
        ctrl: controllerRef.current!,
        section,
        prevSection: prev,
        hasFetched: hasFetchedRef.current,
      },
      opts
    )
    return () => {
      controllerRef.current!.stop()
    }
  }, [
    section,
    opts.page,
    opts.perPage,
    opts.search,
    opts.sort,
    opts.sortDir,
    opts.filters,
    opts.timeRange,
    opts.refreshKey,
  ])

  const actions = useDashboardActions(controllerRef)
  return {
    data: state.data,
    meta: state.meta,
    isLoading: state.isLoading,
    error: state.error,
    ...actions,
  } as const
}

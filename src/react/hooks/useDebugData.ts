import { useState, useEffect, useRef, useCallback } from 'react'

import { DebugDataController } from '../../core/debug-data-controller.js'

import type { DebugTab, DebugPanelProps } from '../../core/types.js'

/**
 * React hook for fetching debug panel data.
 *
 * Thin wrapper around {@link DebugDataController} — bridges the
 * controller's callbacks into React state so consumers get the
 * same reactive interface as before.
 */
export function useDebugData<T = unknown>(tab: DebugTab, options: DebugPanelProps = {}) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options

  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const controllerRef = useRef<DebugDataController<T> | null>(null)

  // Lazily create (or re-create) the controller when config changes.
  if (!controllerRef.current) {
    controllerRef.current = new DebugDataController<T>({
      baseUrl,
      endpoint: debugEndpoint,
      authToken,
      onData: (d) => setData(d),
      onLoading: (l) => setIsLoading(l),
      onError: (e) => setError(e),
      onUnauthorized: (e) => setError(e),
    })
  }

  useEffect(() => {
    const ctrl = controllerRef.current!
    ctrl.start(tab)
    return () => ctrl.stop()
  }, [tab])

  const refresh = useCallback(() => {
    controllerRef.current?.refresh()
  }, [])

  const clearData = useCallback(() => {
    setData(null)
  }, [])

  const cacheForTab = useCallback((tabName: string, tabData: unknown) => {
    controllerRef.current?.cacheForTab(tabName, tabData)
  }, [])

  return { data, isLoading, error, refresh, clearData, cacheForTab } as const
}

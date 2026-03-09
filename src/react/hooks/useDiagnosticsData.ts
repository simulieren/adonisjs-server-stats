import { useState, useEffect, useRef, useCallback } from 'react'

import { UnauthorizedError } from '../../core/api-client.js'
import { useApiClient } from './useApiClient.js'

import type { DiagnosticsResponse } from '../../core/types.js'

interface UseDiagnosticsDataOptions {
  baseUrl?: string
  debugEndpoint?: string
  authToken?: string
  /** Polling interval in ms. Defaults to 3000. */
  refreshInterval?: number
}

export function useDiagnosticsData(options: UseDiagnosticsDataOptions = {}) {
  const {
    baseUrl = '',
    debugEndpoint = '/admin/api/debug',
    authToken,
    refreshInterval = 3000,
  } = options

  const [data, setData] = useState<DiagnosticsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getClient = useApiClient(baseUrl, authToken)

  const fetchData = useCallback(async () => {
    try {
      const client = getClient()
      const result = await client.get<DiagnosticsResponse>(`${debugEndpoint}/diagnostics`)
      setData(result)
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
  }, [debugEndpoint, getClient])

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    fetchData()

    timerRef.current = setInterval(fetchData, refreshInterval)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [fetchData, refreshInterval])

  return { data, isLoading, error }
}

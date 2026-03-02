import React, { useState, useEffect, useRef, useCallback } from 'react'

import { UnauthorizedError } from '../../../../core/api-client.js'
import { SECTION_REFRESH_MS } from '../../../../core/constants.js'
import { useApiClient } from '../../../hooks/useApiClient.js'
import { InternalsContent } from '../../shared/InternalsContent.js'

import type { DashboardHookOptions, DiagnosticsResponse } from '../../../../core/types.js'

interface InternalsSectionProps {
  options?: DashboardHookOptions
  debugEndpoint?: string
}

/**
 * Dashboard section that shows package internals diagnostics.
 *
 * Fetches from {debugEndpoint}/diagnostics (the debug API, not the dashboard API)
 * since this data is provided by the debug controller.
 */
export function InternalsSection({
  options = {},
  debugEndpoint = '/admin/api/debug',
}: InternalsSectionProps) {
  const { baseUrl = '', authToken } = options

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

    timerRef.current = setInterval(fetchData, SECTION_REFRESH_MS)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [fetchData])

  if (isLoading && !data) {
    return <div className="ss-dash-empty">Loading diagnostics...</div>
  }

  if (error) {
    return <div className="ss-dash-empty">Error: {error.message}</div>
  }

  if (!data) {
    return <div className="ss-dash-empty">Diagnostics not available</div>
  }

  return <InternalsContent data={data} tableClassName="ss-dash-table" classPrefix="ss-dash" />
}

export default InternalsSection

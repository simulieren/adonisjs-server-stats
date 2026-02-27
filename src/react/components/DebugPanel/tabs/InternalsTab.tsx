import React, { useState, useEffect, useRef, useCallback } from 'react'

import { ApiClient, UnauthorizedError } from '../../../../core/api-client.js'
import { InternalsContent } from '../../shared/InternalsContent.js'

import type { DebugPanelProps } from '../../../../core/types.js'
import type { DiagnosticsResponse } from '../../shared/InternalsContent.js'

const REFRESH_INTERVAL = 3000

interface InternalsTabProps {
  options?: DebugPanelProps
}

/**
 * Debug panel tab that shows package internals diagnostics.
 *
 * Fetches from {debugEndpoint}/diagnostics.
 */
export function InternalsTab({ options }: InternalsTabProps) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options || {}

  const [data, setData] = useState<DiagnosticsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<ApiClient | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken })
    }
    return clientRef.current
  }, [baseUrl, authToken])

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

    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [fetchData])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading diagnostics...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  if (!data) {
    return <div className="ss-dbg-empty">Diagnostics not available</div>
  }

  return <InternalsContent data={data} tableClassName="ss-dbg-table" classPrefix="ss-dbg" />
}

export default InternalsTab

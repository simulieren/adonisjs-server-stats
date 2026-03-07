import { useState, useEffect, useRef } from 'react'

import { detectFeatures, DEFAULT_FEATURES } from '../../core/feature-detect.js'

import type { FeatureConfig, DebugPanelProps } from '../../core/types.js'

/**
 * React hook for feature detection.
 *
 * Fetches the feature configuration from the debug config endpoint
 * on mount and provides the result.
 */
export function useFeatures(options: DebugPanelProps = {}) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options
  const [features, setFeatures] = useState<FeatureConfig>(DEFAULT_FEATURES)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    let cancelled = false

    const doFetch = async () => {
      try {
        const config = await detectFeatures({ baseUrl, debugEndpoint, authToken })
        if (!cancelled) {
          setFeatures(config)
          setIsLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setIsLoading(false)
        }
      }
    }

    doFetch()

    return () => {
      cancelled = true
    }
  }, [baseUrl, debugEndpoint, authToken])

  return { features, isLoading, error } as const
}

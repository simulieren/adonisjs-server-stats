import { useRef, useCallback } from 'react'

import { ApiClient } from '../../core/api-client.js'

/**
 * React hook that lazily creates and memoizes an {@link ApiClient} instance.
 *
 * Returns a stable getter function that creates the client on first call
 * and reuses it on subsequent calls. A new client is created when
 * `baseUrl` or `authToken` change.
 */
export function useApiClient(baseUrl: string = '', authToken?: string) {
  const clientRef = useRef<ApiClient | null>(null)

  return useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({ baseUrl, authToken })
    }
    return clientRef.current
  }, [baseUrl, authToken])
}

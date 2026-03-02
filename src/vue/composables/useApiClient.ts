import { ApiClient } from '../../core/api-client.js'

/**
 * Vue composable that lazily creates and memoizes an {@link ApiClient} instance.
 *
 * Returns a getter function that creates the client on first call
 * and reuses it on subsequent calls.
 */
export function useApiClient(baseUrl: string = '', authToken?: string) {
  let client: ApiClient | null = null

  return function getClient(): ApiClient {
    if (!client) {
      client = new ApiClient({ baseUrl, authToken })
    }
    return client
  }
}

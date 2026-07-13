import { ApiClient } from '../../core/api-client.js'

/**
 * Vue composable that lazily creates and memoizes an {@link ApiClient} instance.
 *
 * Returns a getter function that creates the client on first call
 * and reuses it on subsequent calls (memoized within the returned closure).
 *
 * IMPORTANT: call this inside a component's `setup()` / `<script setup>` scope
 * (or an `onMounted` callback), never at module-evaluation time. The memoized
 * client captures the `baseUrl`/`authToken` passed in; invoking it once at
 * module scope would make the same client — and its stale config/credentials —
 * shared across every component instance and hot-reload. Called per-setup, each
 * instance gets its own client reflecting its own injected configuration.
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

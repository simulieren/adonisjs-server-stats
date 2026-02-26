/**
 * Vue composable for feature detection.
 *
 * Fetches the server's feature configuration on mount
 * to determine which collectors are active.
 */

import { ref, onMounted } from 'vue'
import { ApiClient, fetchFeatures, DEFAULT_FEATURES } from '../../core/index.js'
import type { FeatureConfig, FeatureFlags } from '../../core/index.js'

export interface UseFeaturesOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Debug endpoint base path. */
  debugEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
}

/**
 * Flatten a {@link FeatureFlags} response into a flat {@link FeatureConfig}.
 */
function toFeatureConfig(flags: FeatureFlags): FeatureConfig {
  return {
    tracing: flags.features?.tracing ?? false,
    redis: flags.features?.redis ?? false,
    queues: flags.features?.queues ?? false,
    cache: flags.features?.cache ?? false,
    emails: flags.features?.emails ?? false,
    dashboard: flags.features?.dashboard ?? false,
    customPanes: flags.customPanes ?? [],
  }
}

export function useFeatures(options: UseFeaturesOptions = {}) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options

  const features = ref<FeatureConfig>({ ...DEFAULT_FEATURES })
  const loading = ref(true)

  onMounted(async () => {
    const client = new ApiClient({ baseUrl, authToken })
    try {
      const flags = await fetchFeatures(client, debugEndpoint)
      features.value = toFeatureConfig(flags)
    } catch {
      // Use defaults on failure
    } finally {
      loading.value = false
    }
  })

  return {
    features,
    loading,
  }
}

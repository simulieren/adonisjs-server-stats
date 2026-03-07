/**
 * Vue composable for feature detection.
 *
 * Fetches the server's feature configuration on mount
 * to determine which collectors are active.
 */

import { ref, onMounted } from 'vue'

import { detectFeatures, DEFAULT_FEATURES } from '../../core/index.js'

import type { FeatureConfig } from '../../core/index.js'

export interface UseFeaturesOptions {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Debug endpoint base path. */
  debugEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
}

export function useFeatures(options: UseFeaturesOptions = {}) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options

  const features = ref<FeatureConfig>({ ...DEFAULT_FEATURES })
  const loading = ref(true)

  onMounted(async () => {
    features.value = await detectFeatures({ baseUrl, debugEndpoint, authToken })
    loading.value = false
  })

  return {
    features,
    loading,
  }
}

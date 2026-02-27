// ---------------------------------------------------------------------------
// Feature detection via config endpoint
// ---------------------------------------------------------------------------

import { ApiClient } from './api-client.js'

import type { FeatureFlags, FeatureConfig } from './types.js'

/**
 * Default debug endpoint base path.
 */
const DEFAULT_DEBUG_ENDPOINT = '/admin/api/debug'

/**
 * Default flattened feature config used before the config endpoint responds.
 *
 * All features default to `false` so the UI starts in a minimal state
 * and progressively enables sections as the server confirms support.
 */
export const DEFAULT_FEATURES: FeatureConfig = {
  tracing: false,
  process: false,
  system: false,
  http: false,
  db: false,
  redis: false,
  queues: false,
  cache: false,
  app: false,
  log: false,
  emails: false,
  dashboard: false,
  customPanes: [],
}

/**
 * Flatten a {@link FeatureFlags} server response into a {@link FeatureConfig}.
 */
function flattenFlags(flags: FeatureFlags): FeatureConfig {
  return {
    tracing: flags.features?.tracing ?? false,
    process: flags.features?.process ?? false,
    system: flags.features?.system ?? false,
    http: flags.features?.http ?? false,
    db: flags.features?.db ?? false,
    redis: flags.features?.redis ?? false,
    queues: flags.features?.queues ?? false,
    cache: flags.features?.cache ?? false,
    app: flags.features?.app ?? false,
    log: flags.features?.log ?? false,
    emails: flags.features?.emails ?? false,
    dashboard: flags.features?.dashboard ?? false,
    customPanes: flags.customPanes ?? [],
  }
}

/**
 * Fetch feature flags and configuration from the server.
 *
 * Calls `GET {debugEndpoint}/config` and returns the full
 * {@link FeatureFlags} response, which tells the UI which
 * sections to render and where to find endpoints.
 *
 * @param apiClient      - Configured {@link ApiClient} instance.
 * @param debugEndpoint  - Base path for the debug API. Defaults to `'/admin/api/debug'`.
 * @returns The parsed feature flags.
 */
export async function fetchFeatures(
  apiClient: ApiClient,
  debugEndpoint: string = DEFAULT_DEBUG_ENDPOINT
): Promise<FeatureFlags> {
  const path = `${debugEndpoint.replace(/\/+$/, '')}/config`
  return apiClient.fetch<FeatureFlags>(path)
}

/**
 * Convenience wrapper around {@link fetchFeatures} that accepts flat options
 * instead of a pre-built {@link ApiClient}.
 *
 * Used by React / Vue hooks that pass simple option objects.
 * Returns a flattened {@link FeatureConfig} for easy property access.
 *
 * @param options - Connection options (baseUrl, debugEndpoint, authToken).
 * @returns The flattened feature config, or {@link DEFAULT_FEATURES} on error.
 */
export async function detectFeatures(options: {
  baseUrl?: string
  debugEndpoint?: string
  authToken?: string
}): Promise<FeatureConfig> {
  const { baseUrl = '', debugEndpoint = DEFAULT_DEBUG_ENDPOINT, authToken } = options
  const client = new ApiClient({ baseUrl, authToken })
  try {
    const flags = await fetchFeatures(client, debugEndpoint)
    return flattenFlags(flags)
  } catch {
    return DEFAULT_FEATURES
  }
}

/**
 * Determine which metric groups should be visible based on feature flags.
 *
 * Returns a `Set` of group identifiers that the stats bar should display.
 * Groups include: `'process'`, `'memory'`, `'http'`, `'db'`, `'app'`, `'redis'`, `'queue'`, `'log'`.
 *
 * Accepts either a nested {@link FeatureFlags} or a flat {@link FeatureConfig}.
 *
 * @param features - The resolved feature flags (nested or flat).
 * @returns A set of visible metric group names.
 */
export function getVisibleMetricGroups(features: FeatureFlags | FeatureConfig): Set<string> {
  const groups = new Set<string>()

  // Handle both nested FeatureFlags and flat FeatureConfig
  const ff =
    'features' in features && typeof features.features === 'object' && features.features !== null
      ? (features as FeatureFlags).features
      : (features as FeatureConfig)

  if ('process' in ff && ff.process) groups.add('process')
  // Memory group shows if process (heap/rss) or system (SYS) collector is present
  if (('process' in ff && ff.process) || ('system' in ff && (ff as any).system)) {
    groups.add('memory')
  }
  if ('http' in ff && ff.http) groups.add('http')
  if ('db' in ff && ff.db) groups.add('db')
  if ('redis' in ff && ff.redis) groups.add('redis')
  if ('queues' in ff && (ff as any).queues) groups.add('queue')
  if ('app' in ff && ff.app) groups.add('app')
  if ('log' in ff && ff.log) groups.add('log')

  return groups
}

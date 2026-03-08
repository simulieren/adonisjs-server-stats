// ---------------------------------------------------------------------------
// Feature detection via config endpoint
// ---------------------------------------------------------------------------

import { ApiClient } from './api-client.js'
import {
  FEATURE_KEYS,
  FLAG_TO_GROUP,
  STATS_GROUP_RULES,
  hasStatValue,
} from './feature-detect-helpers.js'

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
  const result = { customPanes: flags.customPanes ?? [] } as FeatureConfig
  const features = flags.features as Record<string, boolean> | undefined
  for (const key of FEATURE_KEYS) {
    result[key] = features?.[key] ?? false
  }
  return result
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

  // Normalise: nested FeatureFlags -> flat record, or use FeatureConfig directly
  const ff =
    'features' in features && typeof features.features === 'object' && features.features !== null
      ? (features as FeatureFlags).features
      : (features as FeatureConfig)

  const flags = ff as Record<string, boolean>
  for (const { flag, group } of FLAG_TO_GROUP) {
    if (flags[flag]) groups.add(group)
  }

  return groups
}

/**
 * Detect which metric groups should be visible based on the actual stats
 * data received from the server.
 *
 * This is used as the primary mechanism for the stats bar to determine
 * which groups to show, mirroring the old vanilla JS behavior where
 * groups were displayed based on what data the server actually sends.
 *
 * Unlike {@link getVisibleMetricGroups} which relies on the debug config
 * endpoint, this function inspects the stats payload directly. This
 * ensures groups are shown even when the debug endpoint is unavailable
 * or not configured (e.g. when `showDebug` is false).
 *
 * @param stats - The server stats snapshot (partial, since not all fields
 *                may be present depending on configured collectors).
 * @returns A set of visible metric group names.
 */
export function detectMetricGroupsFromStats(stats: Record<string, unknown>): Set<string> {
  const groups = new Set<string>()

  // Process group has special nodeVersion (string) check
  if (hasStatValue(stats.cpuPercent) || hasStatValue(stats.uptime) || hasNodeVersion(stats)) {
    groups.add('process')
  }

  // Data-driven: check each group's fields for numeric values
  for (const rule of STATS_GROUP_RULES) {
    if (rule.fields.some((f) => hasStatValue(stats[f]))) {
      groups.add(rule.group)
    }
  }

  // Redis group: special case -- redisOk can be false but still means collector is active
  if (stats.redisOk !== undefined && stats.redisOk !== null) {
    groups.add('redis')
  }

  return groups
}

/** Check if stats has a non-empty nodeVersion string. */
function hasNodeVersion(stats: Record<string, unknown>): boolean {
  return typeof stats.nodeVersion === 'string' && stats.nodeVersion.length > 0
}

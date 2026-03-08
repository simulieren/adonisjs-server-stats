/**
 * Boot initialization helpers for ServerStatsProvider.
 * Pure functions for endpoint derivation, dashboard path computation, and route path collection.
 */

/**
 * Derive stats and debug endpoint paths from config.
 */
export function deriveEndpointPaths(
  endpoint: string | false | undefined,
  devToolbar?: {
    enabled?: boolean
    debugEndpoint?: string
    dashboard?: boolean
    dashboardPath?: string
  }
): { statsEndpoint: string | false; debugEndpoint: string | undefined } {
  const statsEndpoint: string | false = typeof endpoint === 'string' ? endpoint : false
  const debugEndpoint = devToolbar?.enabled
    ? (devToolbar.debugEndpoint ?? '/admin/api/debug')
    : undefined
  return { statsEndpoint, debugEndpoint }
}

/**
 * Compute the dashboard path from toolbar config and dependency availability.
 */
export function computeDashboardPath(
  devToolbar?: { enabled?: boolean; dashboard?: boolean; dashboardPath?: string },
  depsAvailable?: boolean
): string | undefined {
  if (!devToolbar?.enabled || !devToolbar.dashboard || !depsAvailable) return undefined
  return devToolbar.dashboardPath ?? '/__stats'
}

/**
 * Collect registered route paths for logging.
 */
export function collectRegisteredPaths(
  statsEndpoint: string | false,
  debugEndpoint?: string,
  dashboardPath?: string
): string[] {
  const paths: string[] = []
  if (typeof statsEndpoint === 'string') paths.push(statsEndpoint)
  if (debugEndpoint) paths.push(debugEndpoint + '/*')
  if (dashboardPath) paths.push(dashboardPath + '/*')
  return paths
}

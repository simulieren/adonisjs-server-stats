import { useMemo } from 'react'

import type { DebugPanelProps } from '../../core/types.js'

/**
 * Derives the dashboard API base URL from a dashboard path and
 * returns options with `debugEndpoint` overridden to point at it.
 *
 * Several debug-panel tabs (Jobs, Cache, Config) need to fetch data
 * from the dashboard API (`/<dashboardPath>/api/…`) instead of the
 * standard debug endpoint. This hook centralises the URL resolution
 * so the logic isn't duplicated across every tab component.
 *
 * @returns `{ dashApiBase, resolvedOptions }` where `dashApiBase` is
 *   the computed API root (or `null` when no dashboard is configured)
 *   and `resolvedOptions` has `debugEndpoint` set to that root.
 */
export function useDashboardApiBase(
  dashboardPath: string | undefined,
  options: DebugPanelProps | undefined
) {
  const dashApiBase = useMemo(
    () => (dashboardPath ? dashboardPath.replace(/\/+$/, '') + '/api' : null),
    [dashboardPath]
  )

  const resolvedOptions = useMemo(
    () => (dashApiBase ? { ...options, debugEndpoint: dashApiBase } : options),
    [dashApiBase, options]
  )

  return { dashApiBase, resolvedOptions } as const
}

import { createContext } from 'react'

import type { OverviewMetrics } from '../../../core/types.js'

/**
 * Shared `overview` poller data, provided by {@link DashboardPage} so the
 * sidebar badges and {@link OverviewSection} read from a single poller
 * instead of running two concurrent 5s pollers against the same endpoint.
 *
 * `undefined` (the default) means no provider is present — consumers fall
 * back to their own `useDashboardData` call so a section still works when
 * mounted standalone.
 */
export interface OverviewDataContextValue {
  data: OverviewMetrics | null
  isLoading: boolean
}

export const OverviewDataContext = createContext<OverviewDataContextValue | undefined>(undefined)

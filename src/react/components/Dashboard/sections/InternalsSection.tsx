import React from 'react'

import { SECTION_REFRESH_MS } from '../../../../core/constants.js'
import { useDiagnosticsData } from '../../../hooks/useDiagnosticsData.js'
import { InternalsContent } from '../../shared/InternalsContent.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface InternalsSectionProps {
  options?: DashboardHookOptions
  debugEndpoint?: string
}

/**
 * Dashboard section that shows package internals diagnostics.
 *
 * Fetches from {debugEndpoint}/diagnostics (the debug API, not the dashboard API)
 * since this data is provided by the debug controller.
 */
export function InternalsSection({
  options = {},
  debugEndpoint = '/admin/api/debug',
}: InternalsSectionProps) {
  const { data, isLoading, error } = useDiagnosticsData({
    baseUrl: options.baseUrl,
    debugEndpoint,
    authToken: options.authToken,
    refreshInterval: SECTION_REFRESH_MS,
  })

  if (isLoading && !data) {
    return <div className="ss-dash-empty">Loading diagnostics...</div>
  }

  if (error) {
    return <div className="ss-dash-empty">Error: {error.message}</div>
  }

  if (!data) {
    return <div className="ss-dash-empty">Diagnostics not available</div>
  }

  return <InternalsContent data={data} tableClassName="ss-dash-table" classPrefix="ss-dash" />
}

export default InternalsSection

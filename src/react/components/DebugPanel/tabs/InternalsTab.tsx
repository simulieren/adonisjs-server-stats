import React from 'react'

import { useDiagnosticsData } from '../../../hooks/useDiagnosticsData.js'
import { InternalsContent } from '../../shared/InternalsContent.js'

import type { DebugPanelProps } from '../../../../core/types.js'

interface InternalsTabProps {
  options?: DebugPanelProps
}

/**
 * Debug panel tab that shows package internals diagnostics.
 *
 * Fetches from {debugEndpoint}/diagnostics.
 */
export function InternalsTab({ options }: InternalsTabProps) {
  const { data, isLoading, error } = useDiagnosticsData({
    baseUrl: options?.baseUrl,
    debugEndpoint: options?.debugEndpoint,
    authToken: options?.authToken,
  })

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading diagnostics...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  if (!data) {
    return <div className="ss-dbg-empty">Diagnostics not available</div>
  }

  return <InternalsContent data={data} tableClassName="ss-dbg-table" classPrefix="ss-dbg" />
}

export default InternalsTab

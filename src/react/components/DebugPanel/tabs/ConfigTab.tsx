import React from 'react'

import { useDebugData } from '../../../hooks/useDebugData.js'
import { useDashboardApiBase } from '../../../hooks/useDashboardApiBase.js'
import { ConfigContent } from '../../shared/ConfigContent.js'

import type { ConfigValue } from '../../shared/ConfigContent.js'
import type { DebugPanelProps } from '../../../../core/types.js'

interface ConfigTabProps {
  options?: DebugPanelProps
  dashboardPath?: string
}

export function ConfigTab({ options, dashboardPath }: ConfigTabProps) {
  const { resolvedOptions } = useDashboardApiBase(dashboardPath, options)
  const { data, isLoading, error } = useDebugData<{
    app?: Record<string, ConfigValue>
    env?: Record<string, ConfigValue>
  }>('config', resolvedOptions)

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return <ConfigContent data={data} isLoading={isLoading} classPrefix="ss-dbg" />
}

export default ConfigTab

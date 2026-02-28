import React, { useMemo } from 'react'

import { useDebugData } from '../../../hooks/useDebugData.js'
import { ConfigContent } from '../../shared/ConfigContent.js'

import type { ConfigValue } from '../../shared/ConfigContent.js'
import type { DebugPanelProps } from '../../../../core/types.js'

interface ConfigTabProps {
  options?: DebugPanelProps
  dashboardPath?: string
}

export function ConfigTab({ options, dashboardPath }: ConfigTabProps) {
  const dashApiBase = useMemo(
    () => (dashboardPath ? dashboardPath.replace(/\/+$/, '') + '/api' : null),
    [dashboardPath]
  )
  const configOptions = useMemo(
    () => (dashApiBase ? { ...options, debugEndpoint: dashApiBase } : options),
    [dashApiBase, options]
  )
  const { data, isLoading, error } = useDebugData<{
    app?: Record<string, ConfigValue>
    env?: Record<string, ConfigValue>
  }>('config', configOptions)

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return <ConfigContent data={data} isLoading={isLoading} classPrefix="ss-dbg" />
}

export default ConfigTab

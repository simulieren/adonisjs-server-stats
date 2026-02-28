import React from 'react'

import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { ConfigContent } from '../../shared/ConfigContent.js'

import type { ConfigValue } from '../../shared/ConfigContent.js'
import type { DashboardHookOptions } from '../../../../core/types.js'

interface ConfigSectionProps {
  options?: DashboardHookOptions
}

export function ConfigSection({ options = {} }: ConfigSectionProps) {
  const { data, isLoading } = useDashboardData<{
    app?: Record<string, ConfigValue>
    env?: Record<string, ConfigValue>
  }>('config', options)

  return <ConfigContent data={data} isLoading={isLoading} classPrefix="ss-dash" />
}

export default ConfigSection

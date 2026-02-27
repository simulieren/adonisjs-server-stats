import React, { useState, useCallback } from 'react'

import { useDashboardData } from '../../../hooks/useDashboardData.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface ConfigSectionProps {
  options?: DashboardHookOptions
}

type ConfigValue = string | number | boolean | null | undefined | ConfigValue[] | { [key: string]: ConfigValue }

/** Recursive config tree renderer. */
function ConfigNode({ obj, path = '', search = '' }: { obj: ConfigValue; path?: string; search?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (obj === null || obj === undefined) {
    return <span className="ss-dash-config-null">null</span>
  }

  if (typeof obj !== 'object') {
    const strVal = String(obj)
    if (typeof obj === 'boolean') {
      return <span className={obj ? 'ss-dash-config-true' : 'ss-dash-config-false'}>{strVal}</span>
    }
    if (typeof obj === 'number') {
      return <span className="ss-dash-config-number">{strVal}</span>
    }
    // Check for redacted values
    if (strVal === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') {
      return <span className="ss-dash-config-redacted">{strVal}</span>
    }
    return <span className="ss-dash-config-string">{strVal}</span>
  }

  if (Array.isArray(obj)) {
    return <span className="ss-dash-config-array">[{obj.length} items]</span>
  }

  const keys = Object.keys(obj)

  return (
    <div className="ss-dash-config-tree">
      {keys.map((key) => {
        const fullPath = path ? `${path}.${key}` : key
        const value = obj[key]
        const isObject = value !== null && typeof value === 'object' && !Array.isArray(value)
        const isExpanded = expanded.has(fullPath)

        // Highlight search matches
        const matchesSearch =
          search &&
          (key.toLowerCase().includes(search.toLowerCase()) ||
            (typeof value === 'string' && value.toLowerCase().includes(search.toLowerCase())))

        return (
          <div key={fullPath} className="ss-dash-config-item">
            <div
              className={`ss-dash-config-row ${matchesSearch ? 'ss-dash-config-match' : ''}`}
              onClick={isObject ? () => toggleExpand(fullPath) : undefined}
              style={{ cursor: isObject ? 'pointer' : 'default' }}
            >
              {isObject ? (
                <span className="ss-dash-config-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
              ) : (
                <span className="ss-dash-config-toggle" />
              )}
              <span className="ss-dash-config-key">{key}</span>
              {isObject ? (
                <span className="ss-dash-config-count">{Object.keys(value).length} keys</span>
              ) : (
                <>
                  <span className="ss-dash-config-sep">:</span>
                  <ConfigNode obj={value} path={fullPath} search={search} />
                </>
              )}
            </div>
            {isObject && isExpanded && (
              <div className="ss-dash-config-children">
                <ConfigNode obj={value} path={fullPath} search={search} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ConfigSection({ options = {} }: ConfigSectionProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'app' | 'env'>('app')

  const { data, isLoading } = useDashboardData<{ app?: Record<string, ConfigValue>; env?: Record<string, ConfigValue> }>('config', options)
  const config = data

  const handleCopy = useCallback(async () => {
    if (!config) return
    try {
      const content = activeTab === 'app' ? config.app : config.env
      await navigator.clipboard.writeText(JSON.stringify(content, null, 2))
    } catch {
      // Silently fail
    }
  }, [config, activeTab])

  return (
    <div>
      <div className="ss-dash-config-header">
        <div className="ss-dash-config-tabs">
          <button
            type="button"
            className={`ss-dash-filter-btn ${activeTab === 'app' ? 'ss-dash-active' : ''}`}
            onClick={() => setActiveTab('app')}
          >
            App Config
          </button>
          <button
            type="button"
            className={`ss-dash-filter-btn ${activeTab === 'env' ? 'ss-dash-active' : ''}`}
            onClick={() => setActiveTab('env')}
          >
            Environment
          </button>
        </div>
        <div className="ss-dash-config-actions">
          <input
            type="text"
            className="ss-dash-search"
            placeholder="Search config..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: '200px' }}
          />
          <button type="button" className="ss-dash-btn" onClick={handleCopy}>
            Copy
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading config...</div>
      ) : !config ? (
        <div className="ss-dash-empty">Config not available</div>
      ) : (
        <div className="ss-dash-config-content">
          <ConfigNode obj={activeTab === 'app' ? config.app : config.env} search={search} />
        </div>
      )}
    </div>
  )
}

export default ConfigSection

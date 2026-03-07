import React, { useState, useCallback, useRef, useEffect } from 'react'

import {
  isRedactedValue as isRedactedObj,
  flattenConfig,
  formatFlatValue,
  countLeaves,
  collectTopLevelObjectKeys,
  copyWithFeedback,
} from '../../../core/config-utils.js'
import { TAB_ICONS } from '../../../core/icons.js'

import type { RedactedValue, ConfigValue } from '../../../core/config-utils.js'

// Re-export types so existing consumers (e.g. Dashboard ConfigSection) keep working
export type { RedactedValue, ConfigValue }

export interface ConfigContentProps {
  data: {
    app?: Record<string, ConfigValue>
    env?: Record<string, ConfigValue>
  } | null
  isLoading: boolean
  classPrefix: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Inline reveal/hide toggle for redacted values.
 */
function RedactedToggle({ redacted, p }: { redacted: RedactedValue; p: string }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <span
      className={`${p}-config-redacted`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
    >
      <span>{revealed ? redacted.value : redacted.display}</span>
      <button
        type="button"
        className={`${p}-btn`}
        title={revealed ? 'Hide' : 'Reveal'}
        style={{
          padding: '0 4px',
          fontSize: '0.85em',
          lineHeight: 1,
          minWidth: 'auto',
        }}
        onClick={(e) => {
          e.stopPropagation()
          setRevealed((prev) => !prev)
        }}
      >
        {revealed ? (
          <svg
            width="14"
            height="14"
            viewBox={TAB_ICONS['eye-off'].viewBox}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: TAB_ICONS['eye-off'].elements.join('') }}
          />
        ) : (
          <svg
            width="14"
            height="14"
            viewBox={TAB_ICONS.eye.viewBox}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: TAB_ICONS.eye.elements.join('') }}
          />
        )}
      </button>
    </span>
  )
}

/* -- Environment table (flat key-value, NOT tree) ------------------------- */

function EnvTable({
  env,
  search,
  p,
}: {
  env: Record<string, ConfigValue>
  search: string
  p: string
}) {
  const btnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const term = search.toLowerCase()

  const entries = Object.entries(env).filter(([key, value]) => {
    if (!term) return true
    const valStr = isRedactedObj(value)
      ? value.display
      : value === null || value === undefined
        ? ''
        : String(value)
    return key.toLowerCase().includes(term) || valStr.toLowerCase().includes(term)
  })

  return (
    <div className={`${p}-config-table-wrap`}>
      <table className={`${p}-table ${p}-config-env-table`}>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Value</th>
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => {
            const redacted = isRedactedObj(value)
            const displayVal = redacted
              ? value.display
              : value === null || value === undefined
                ? 'null'
                : String(value)
            const copyVal = `${key}=${displayVal}`

            return (
              <tr key={key}>
                <td className={`${p}-env-key`}>
                  <span className={`${p}-config-key`}>{key}</span>
                </td>
                <td className={`${p}-env-val`}>
                  {redacted ? (
                    <RedactedToggle redacted={value as RedactedValue} p={p} />
                  ) : (
                    <span className={`${p}-config-val`}>{displayVal}</span>
                  )}
                </td>
                <td>
                  {!redacted && (
                    <button
                      type="button"
                      className={`${p}-copy-row-btn`}
                      title="Copy"
                      ref={(el) => {
                        btnRefs.current.set(key, el)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        copyWithFeedback(copyVal, btnRefs.current.get(key) ?? null, p)
                      }}
                    >
                      {'\u2398'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: 'center', color: 'var(--ss-dim)' }}>
                No matching variables
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* -- Flat search table for app config (shown when search is active) ------- */

function FlatConfigSearchTable({
  source,
  search,
  p,
}: {
  source: Record<string, ConfigValue>
  search: string
  p: string
}) {
  const btnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const term = search.toLowerCase()
  const allEntries = flattenConfig(source, '')
  const filtered = allEntries.filter((item) => {
    const valStr = isRedactedObj(item.value)
      ? item.value.display
      : item.value === null || item.value === undefined
        ? ''
        : String(item.value)
    return item.path.toLowerCase().includes(term) || valStr.toLowerCase().includes(term)
  })

  return (
    <div className={`${p}-config-table-wrap`}>
      <table className={`${p}-table`}>
        <thead>
          <tr>
            <th>Path</th>
            <th>Value</th>
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((item) => {
            const redacted = isRedactedObj(item.value)
            const fmt = redacted ? null : formatFlatValue(item.value)
            const displayVal = redacted ? (item.value as RedactedValue).display : fmt!.text
            const copyVal = `${item.path}: ${displayVal}`

            return (
              <tr key={item.path}>
                <td>
                  <span className={`${p}-config-key`} style={{ whiteSpace: 'nowrap' }}>
                    {item.path}
                  </span>
                </td>
                <td>
                  {redacted ? (
                    <RedactedToggle redacted={item.value as RedactedValue} p={p} />
                  ) : (
                    <span
                      className={`${p}-config-val`}
                      style={{ wordBreak: 'break-all', color: fmt!.color }}
                    >
                      {fmt!.text}
                    </span>
                  )}
                </td>
                <td>
                  {!redacted && (
                    <button
                      type="button"
                      className={`${p}-copy-row-btn`}
                      title="Copy"
                      ref={(el) => {
                        btnRefs.current.set(item.path, el)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        copyWithFeedback(copyVal, btnRefs.current.get(item.path) ?? null, p)
                      }}
                    >
                      {'\u2398'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: 'center', color: 'var(--ss-dim)' }}>
                No matching entries
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div
        style={{
          padding: '4px 16px',
          fontSize: '10px',
          color: 'var(--ss-muted)',
        }}
      >
        {filtered.length} of {allEntries.length} entries
      </div>
    </div>
  )
}

/* -- Inner table for expanded config sections ----------------------------- */

function ConfigInnerTable({ obj, prefix, p }: { obj: ConfigValue; prefix: string; p: string }) {
  const btnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const entries = flattenConfig(obj, prefix)

  return (
    <table className={`${p}-table ${p}-config-inner-table`}>
      <thead>
        <tr>
          <th style={{ width: '35%' }}>Key</th>
          <th>Value</th>
          <th style={{ width: 36 }}></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((item) => {
          // Show relative path (strip the section prefix)
          const relPath =
            item.path.indexOf(prefix + '.') === 0 ? item.path.slice(prefix.length + 1) : item.path
          const redacted = isRedactedObj(item.value)
          const fmt = redacted ? null : formatFlatValue(item.value)
          const displayVal = redacted ? (item.value as RedactedValue).display : fmt!.text
          const copyVal = `${item.path}: ${displayVal}`

          return (
            <tr key={item.path}>
              <td title={relPath}>
                <span className={`${p}-config-key`}>{relPath}</span>
              </td>
              <td title={displayVal}>
                {redacted ? (
                  <RedactedToggle redacted={item.value as RedactedValue} p={p} />
                ) : (
                  <span className={`${p}-config-val`} style={{ color: fmt!.color }}>
                    {fmt!.text}
                  </span>
                )}
              </td>
              <td>
                {!redacted && (
                  <button
                    type="button"
                    className={`${p}-copy-row-btn`}
                    title="Copy"
                    ref={(el) => {
                      btnRefs.current.set(item.path, el)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      copyWithFeedback(copyVal, btnRefs.current.get(item.path) ?? null, p)
                    }}
                  >
                    {'\u2398'}
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* -- Format a single leaf value with color coding ------------------------- */

function FormattedValue({ value, p }: { value: ConfigValue; p: string }) {
  if (value === null || value === undefined) {
    return (
      <span className={`${p}-config-val`} style={{ color: 'var(--ss-dim)' }}>
        null
      </span>
    )
  }
  if (isRedactedObj(value)) {
    return <RedactedToggle redacted={value} p={p} />
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={`${p}-config-val`}
        style={{ color: value ? 'var(--ss-green-fg)' : 'var(--ss-red-fg)' }}
      >
        {String(value)}
      </span>
    )
  }
  if (typeof value === 'number') {
    return (
      <span className={`${p}-config-val`} style={{ color: 'var(--ss-amber-fg)' }}>
        {String(value)}
      </span>
    )
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === null || item === undefined) return 'null'
      if (typeof item === 'object') return JSON.stringify(item)
      return String(item)
    })
    return (
      <span className={`${p}-config-val`} style={{ color: 'var(--ss-purple-fg)' }}>
        [{items.join(', ')}]
      </span>
    )
  }
  if (typeof value === 'object') {
    return (
      <span className={`${p}-config-val`} style={{ color: 'var(--ss-dim)' }}>
        {JSON.stringify(value)}
      </span>
    )
  }
  return <span className={`${p}-config-val`}>{String(value)}</span>
}

/* -- Top-level config tree with collapsible sections ---------------------- */

function ConfigTree({
  obj,
  expandedPaths,
  onToggle,
  p,
}: {
  obj: ConfigValue
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  p: string
}) {
  if (
    obj === null ||
    obj === undefined ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    isRedactedObj(obj)
  ) {
    return null
  }

  const keys = Object.keys(obj)
  const leafBtnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())

  return (
    <div className={`${p}-config-sections`}>
      {keys.map((key) => {
        const value = obj[key]
        const isObject =
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !isRedactedObj(value)
        const isExpanded = expandedPaths.has(key)
        const redacted = isRedactedObj(value)

        return (
          <div key={key} className={`${p}-config-section`}>
            <div
              className={`${p}-config-section-header${!isObject ? ` ${p}-config-leaf` : ''}`}
              onClick={isObject ? () => onToggle(key) : undefined}
              style={{ cursor: isObject ? 'pointer' : 'default' }}
            >
              {isObject ? (
                <span className={`${p}-config-toggle`}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
              ) : (
                <span className={`${p}-config-toggle`} style={{ visibility: 'hidden' }}>
                  &bull;
                </span>
              )}
              <span className={`${p}-config-key`}>{key}</span>
              {isObject ? (
                <span className={`${p}-config-count`}>{countLeaves(value)} entries</span>
              ) : (
                <>
                  <span className={`${p}-config-val`} style={{ marginLeft: '8px' }}>
                    <FormattedValue value={value} p={p} />
                  </span>
                  {!redacted && (
                    <button
                      type="button"
                      className={`${p}-copy-row-btn`}
                      style={{ marginLeft: '4px' }}
                      title="Copy"
                      ref={(el) => {
                        leafBtnRefs.current.set(key, el)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        const fmt = formatFlatValue(value)
                        copyWithFeedback(
                          `${key}: ${fmt.text}`,
                          leafBtnRefs.current.get(key) ?? null,
                          p
                        )
                      }}
                    >
                      {'\u2398'}
                    </button>
                  )}
                </>
              )}
            </div>
            {isObject && isExpanded && (
              <div className={`${p}-config-section-body`}>
                <ConfigInnerTable obj={value} prefix={key} p={p} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConfigContent({ data, isLoading, classPrefix }: ConfigContentProps) {
  const p = classPrefix

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'app' | 'env'>('app')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [copyLabel, setCopyLabel] = useState('Copy JSON')

  // Debounce search by 200ms
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 200)
    return () => clearTimeout(timer)
  }, [searchInput])

  const config = data

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    if (!config) return
    const source = activeTab === 'app' ? config.app : config.env
    if (!source) return
    const allKeys = collectTopLevelObjectKeys(source)
    setExpandedPaths(new Set(allKeys))
  }, [config, activeTab])

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  const handleCopy = useCallback(async () => {
    if (!config) return
    try {
      const content = activeTab === 'app' ? config.app : config.env
      await navigator.clipboard.writeText(JSON.stringify(content, null, 2))
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy JSON'), 1500)
    } catch {
      // Silently fail
    }
  }, [config, activeTab])

  return (
    <div>
      {/* Toolbar */}
      <div
        className={`${p}-config-toolbar`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
        }}
      >
        {/* Left side: tab toggle buttons */}
        <button
          type="button"
          className={`${p}-config-tab${activeTab === 'app' ? ` ${p}-active` : ''}`}
          onClick={() => setActiveTab('app')}
        >
          App Config
        </button>
        <button
          type="button"
          className={`${p}-config-tab${activeTab === 'env' ? ` ${p}-active` : ''}`}
          onClick={() => setActiveTab('env')}
        >
          Env
        </button>

        {/* Middle: search input */}
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            className={`${p}-search`}
            placeholder="Search keys and values..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: '100%' }}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: 'var(--ss-dim)',
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              {'\u00D7'}
            </button>
          )}
        </div>

        {/* Right side: expand/collapse + copy */}
        {activeTab === 'app' && !search && (
          <>
            <button type="button" className={`${p}-btn`} onClick={expandAll}>
              Expand All
            </button>
            <button type="button" className={`${p}-btn`} onClick={collapseAll}>
              Collapse All
            </button>
          </>
        )}
        <button type="button" className={`${p}-btn`} onClick={handleCopy}>
          {copyLabel}
        </button>
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <div className={`${p}-empty`}>Loading config...</div>
      ) : !config ? (
        <div className={`${p}-empty`}>Config not available</div>
      ) : activeTab === 'env' ? (
        <EnvTable env={config.env ?? {}} search={search} p={p} />
      ) : search ? (
        <FlatConfigSearchTable source={config.app ?? {}} search={search} p={p} />
      ) : (
        <div className={`${p}-config-table-wrap`}>
          <ConfigTree
            obj={config.app}
            expandedPaths={expandedPaths}
            onToggle={handleToggle}
            p={p}
          />
        </div>
      )}
    </div>
  )
}

export default ConfigContent

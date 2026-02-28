import React, { useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BufferInfo {
  current: number
  max: number
}

interface CollectorInfo {
  name: string
  label: string
  status: 'healthy' | 'errored' | 'stopped'
  lastError: string | null
  lastErrorAt: number | null
  config: Record<string, unknown>
}

interface TimerInfo {
  active: boolean
  intervalMs?: number
  debounceMs?: number
}

interface DiagnosticsResponse {
  package: {
    version: string
    nodeVersion: string
    adonisVersion: string
    uptime?: number
  }
  config: {
    intervalMs: number
    transport: string
    channelName: string
    endpoint: string | false
    skipInTest: boolean
    hasOnStatsCallback: boolean
    hasShouldShowCallback: boolean
  }
  devToolbar: {
    enabled: boolean
    maxQueries: number
    maxEvents: number
    maxEmails: number
    maxTraces: number
    slowQueryThresholdMs: number
    tracing: boolean
    dashboard: boolean
    dashboardPath: string
    debugEndpoint: string
    retentionDays: number
    dbPath: string
    persistDebugData: boolean | string
    excludeFromTracing: string[]
    customPaneCount: number
  }
  collectors: CollectorInfo[]
  buffers: Record<string, BufferInfo>
  timers: Record<string, TimerInfo>
  transmit: {
    available: boolean
    channels: string[]
  }
  integrations: Record<string, { active?: boolean; available?: boolean; mode?: string }>
  storage: {
    ready: boolean
    dbPath: string
    fileSizeMb: number
    walSizeMb: number
    retentionDays: number
    tables: Array<{ name: string; rowCount: number }>
    lastCleanupAt: number | null
  } | null
}

export type { DiagnosticsResponse }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_KEYS = ['password', 'secret', 'token', 'key', 'credential', 'auth']

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SECRET_KEYS.some((s) => lower.includes(s))
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${ms / 1000}s`
  if (ms < 3_600_000) return `${ms / 60_000}m`
  return `${ms / 3_600_000}h`
}

function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return '-'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function formatConfigVal(val: unknown): string {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
    return String(val)
  if (Array.isArray(val)) return val.join(', ') || '-'
  try {
    return JSON.stringify(val)
  } catch {
    return String(val)
  }
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

function StatusDot({ status, prefix }: { status: string; prefix: string }) {
  let cls = `${prefix}-dot`
  if (['healthy', 'active', 'connected', 'available', 'ready'].includes(status)) {
    cls += ` ${prefix}-dot-ok`
  } else if (['errored', 'unavailable'].includes(status)) {
    cls += ` ${prefix}-dot-err`
  }
  return <span className={cls} />
}

// ---------------------------------------------------------------------------
// RedactedValue
// ---------------------------------------------------------------------------

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
  </svg>
)

function RedactedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <span>
      {revealed ? value : '••••••••'}{' '}
      <button
        type="button"
        onClick={() => setRevealed((prev) => !prev)}
        style={{
          background: 'none',
          border: '1px solid var(--ss-border)',
          borderRadius: 3,
          padding: '0 4px',
          fontSize: '10px',
          color: 'var(--ss-dim)',
          cursor: 'pointer',
          verticalAlign: 'middle',
        }}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({ current, max, prefix }: { current: number; max: number; prefix: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0
  const isFull = pct >= 100

  return (
    <div className={`${prefix}-bar`}>
      <div className={`${prefix}-bar-track`}>
        <div
          className={`${prefix}-bar-fill${isFull ? ` ${prefix}-bar-fill-warn` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`${prefix}-bar-pct${isFull ? ` ${prefix}-bar-pct-warn` : ''}`}>{pct}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfigInline — renders collector config as key=value pairs
// ---------------------------------------------------------------------------

function ConfigInline({ config, prefix }: { config: Record<string, unknown>; prefix: string }) {
  const entries = Object.entries(config)
  if (entries.length === 0) return <span className={`${prefix}-c-dim`}>-</span>

  return (
    <span className={`${prefix}-c-muted`}>
      {entries.map(([key, val], i) => (
        <span key={key}>
          {i > 0 && ', '}
          <span className={`${prefix}-c-dim`}>{key}</span>
          {'='}
          {isSecretKey(key) && typeof val === 'string' ? (
            <RedactedValue value={val} />
          ) : (
            <span>{formatConfigVal(val)}</span>
          )}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// InfoCard — compact key-value display for package info
// ---------------------------------------------------------------------------

function InfoCard({ label, value, prefix }: { label: string; value: string; prefix: string }) {
  return (
    <div className={`${prefix}-info-card`}>
      <span className={`${prefix}-info-card-label`}>{label}</span>
      <span className={`${prefix}-info-card-value`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InternalsContent
// ---------------------------------------------------------------------------

interface InternalsContentProps {
  data: DiagnosticsResponse
  tableClassName: string
  classPrefix?: string
}

export function InternalsContent({ data, tableClassName, classPrefix }: InternalsContentProps) {
  const p = classPrefix || 'ss-dash'

  const [revealedConfigs, setRevealedConfigs] = useState<Set<string>>(new Set())

  const toggleReveal = useCallback((key: string) => {
    setRevealedConfigs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const renderConfigValue = useCallback(
    (key: string, value: unknown): React.ReactNode => {
      if (value === null || value === undefined) return <span className={`${p}-c-dim`}>null</span>
      if (typeof value === 'boolean')
        return (
          <span className={value ? `${p}-c-green` : `${p}-c-red`}>
            {String(value)}
          </span>
        )
      if (Array.isArray(value)) return <span>{value.join(', ') || '-'}</span>
      const strVal = formatConfigVal(value)
      if (isSecretKey(key)) {
        const isRevealed = revealedConfigs.has(key)
        return (
          <span>
            {isRevealed ? strVal : '••••••••'}{' '}
            <button
              type="button"
              onClick={() => toggleReveal(key)}
              style={{
                background: 'none',
                border: '1px solid var(--ss-border)',
                borderRadius: 3,
                padding: '0 4px',
                fontSize: '10px',
                color: 'var(--ss-dim)',
                cursor: 'pointer',
                verticalAlign: 'middle',
              }}
            >
              {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
        )
      }
      return <span>{strVal}</span>
    },
    [revealedConfigs, toggleReveal, p]
  )

  // Timer display names
  const timerLabels: Record<string, string> = {
    collectionInterval: 'Stats Collection',
    dashboardBroadcast: 'Dashboard Broadcast',
    debugBroadcast: 'Debug Broadcast',
    persistFlush: 'Persist Flush',
    retentionCleanup: 'Retention Cleanup',
  }

  // Integration display names
  const integrationLabels: Record<string, string> = {
    prometheus: 'Prometheus',
    pinoHook: 'Pino Log Hook',
    edgePlugin: 'Edge Plugin',
    cacheInspector: 'Cache Inspector',
    queueInspector: 'Queue Inspector',
  }

  return (
    <div>
      {/* 1. Package Info — compact card row */}
      <h3 className={`${p}-internals-title`}>Package Info</h3>
      <div className={`${p}-info-cards`}>
        <InfoCard label="Version" value={data.package.version || '-'} prefix={p} />
        <InfoCard label="Node.js" value={data.package.nodeVersion || '-'} prefix={p} />
        <InfoCard label="AdonisJS" value={data.package.adonisVersion || '-'} prefix={p} />
        <InfoCard label="Uptime" value={formatUptime(data.package.uptime)} prefix={p} />
      </div>

      {/* 2. Collectors — merged name+label column */}
      {data.collectors.length > 0 && (
        <>
          <h3 className={`${p}-internals-title`}>Collectors</h3>
          <table className={tableClassName}>
            <thead>
              <tr>
                <th>Collector</th>
                <th>Status</th>
                <th>Last Error</th>
                <th>Config</th>
              </tr>
            </thead>
            <tbody>
              {data.collectors.map((c) => (
                <tr key={c.name}>
                  <td>
                    <code>{c.name}</code>
                    {c.label && c.label !== c.name && <span className={`${p}-c-dim`}>{' '}{c.label}</span>}
                  </td>
                  <td>
                    <StatusDot status={c.status} prefix={p} />
                    {c.status}
                  </td>
                  <td className={c.lastError ? `${p}-c-red` : `${p}-c-dim`}>
                    {c.lastError ? (
                      <>
                        {c.lastError}
                        {c.lastErrorAt && (
                          <span className={`${p}-c-dim`} style={{ fontSize: '10px' }}>
                            {formatRelativeTime(c.lastErrorAt)}
                          </span>
                        )}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    <ConfigInline config={c.config} prefix={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 3. Buffers */}
      <h3 className={`${p}-internals-title`}>Buffers</h3>
      <table className={tableClassName}>
        <thead>
          <tr>
            <th>Buffer</th>
            <th>Usage</th>
            <th>Fill %</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.buffers).map(([name, buf]) => (
            <tr key={name}>
              <td style={{ textTransform: 'capitalize' }}>{name}</td>
              <td>
                {formatNumber(buf.current)} / {formatNumber(buf.max)}
              </td>
              <td>
                <ProgressBar current={buf.current} max={buf.max} prefix={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 4. Timers — human-readable intervals */}
      <h3 className={`${p}-internals-title`}>Timers</h3>
      <table className={tableClassName}>
        <thead>
          <tr>
            <th>Timer</th>
            <th>Status</th>
            <th>Interval</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.timers).map(([name, timer]) => (
            <tr key={name}>
              <td>{timerLabels[name] || name}</td>
              <td>
                <StatusDot status={timer.active ? 'active' : 'inactive'} prefix={p} />
                <span className={timer.active ? `${p}-c-green` : `${p}-c-dim`}>
                  {timer.active ? 'active' : 'inactive'}
                </span>
              </td>
              <td>
                {!timer.active ? (
                  <span className={`${p}-c-dim`}>&mdash;</span>
                ) : timer.intervalMs ? (
                  formatMs(timer.intervalMs)
                ) : timer.debounceMs ? (
                  `${formatMs(timer.debounceMs)} (debounce)`
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 5. Integrations */}
      <h3 className={`${p}-internals-title`}>Integrations</h3>
      <table className={tableClassName}>
        <thead>
          <tr>
            <th>Integration</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {/* Transmit row */}
          <tr>
            <td>Transmit (SSE)</td>
            <td>
              <StatusDot status={data.transmit.available ? 'connected' : 'inactive'} prefix={p} />
              {data.transmit.available ? 'connected' : 'unavailable'}
            </td>
            <td style={{ fontSize: '11px' }}>
              {data.transmit.channels.length > 0
                ? `Channels: ${data.transmit.channels.join(', ')}`
                : '-'}
            </td>
          </tr>
          {/* Other integrations */}
          {Object.entries(data.integrations).map(([name, info]) => {
            const isActive = info.active ?? info.available ?? false
            const statusLabel = info.active
              ? 'active'
              : info.available
                ? 'available'
                : 'unavailable'

            let detail: string = info.mode ? `Mode: ${info.mode}` : '-'
            if (name === 'edgePlugin' && info.active) {
              detail = '@serverStats() tag registered'
            } else if (name === 'cacheInspector' && info.available) {
              detail = 'Redis dependency detected'
            } else if (name === 'queueInspector' && info.available) {
              detail = 'Queue dependency detected'
            }

            return (
              <tr key={name}>
                <td>{integrationLabels[name] || name}</td>
                <td>
                  <StatusDot status={isActive ? 'active' : 'inactive'} prefix={p} />
                  {statusLabel}
                </td>
                <td className={`${p}-c-dim`} style={{ fontSize: '11px' }}>
                  {detail}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* 6. Storage (conditional) */}
      {data.storage && (
        <>
          <h3 className={`${p}-internals-title`}>Storage (SQLite)</h3>
          <table className={tableClassName}>
            <thead>
              <tr>
                <th style={{ width: '200px' }}>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Status</td>
                <td>
                  <StatusDot status={data.storage.ready ? 'ready' : 'inactive'} prefix={p} />
                  {data.storage.ready ? 'ready' : 'not ready'}
                </td>
              </tr>
              <tr>
                <td>DB Path</td>
                <td><code>{data.storage.dbPath}</code></td>
              </tr>
              <tr>
                <td>File Size</td>
                <td>{data.storage.fileSizeMb.toFixed(1)} MB</td>
              </tr>
              <tr>
                <td>WAL Size</td>
                <td>{data.storage.walSizeMb.toFixed(1)} MB</td>
              </tr>
              <tr>
                <td>Retention</td>
                <td>{data.storage.retentionDays} days</td>
              </tr>
              <tr>
                <td>Last Cleanup</td>
                <td>
                  {data.storage.lastCleanupAt
                    ? formatRelativeTime(data.storage.lastCleanupAt)
                    : '-'}
                </td>
              </tr>
            </tbody>
          </table>

          {data.storage.tables.length > 0 && (
            <table className={tableClassName} style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {data.storage.tables.map((t) => (
                  <tr key={t.name}>
                    <td><code>{t.name}</code></td>
                    <td>{formatNumber(t.rowCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* 7. Resolved Config */}
      <h3 className={`${p}-internals-title`}>Resolved Config</h3>
      <table className={tableClassName}>
        <thead>
          <tr>
            <th style={{ width: '200px' }}>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>intervalMs</td>
            <td>{data.config.intervalMs}</td>
          </tr>
          <tr>
            <td>transport</td>
            <td>{data.config.transport}</td>
          </tr>
          <tr>
            <td>channelName</td>
            <td>{data.config.channelName}</td>
          </tr>
          <tr>
            <td>endpoint</td>
            <td>{data.config.endpoint === false ? 'false' : data.config.endpoint}</td>
          </tr>
          <tr>
            <td>skipInTest</td>
            <td>{renderConfigValue('skipInTest', data.config.skipInTest)}</td>
          </tr>
          <tr>
            <td>onStats callback</td>
            <td>{data.config.hasOnStatsCallback ? 'defined' : 'not defined'}</td>
          </tr>
          <tr>
            <td>shouldShow callback</td>
            <td>{data.config.hasShouldShowCallback ? 'defined' : 'not defined'}</td>
          </tr>
        </tbody>
      </table>

      <h4 className={`${p}-internals-title`}>DevToolbar</h4>
      <table className={tableClassName}>
        <thead>
          <tr>
            <th style={{ width: '200px' }}>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.devToolbar).map(([key, value]) => (
            <tr key={key}>
              <td>{key === 'customPaneCount' ? 'customPanes' : key}</td>
              <td>
                {key === 'customPaneCount' ? `${value} registered` : renderConfigValue(key, value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default InternalsContent

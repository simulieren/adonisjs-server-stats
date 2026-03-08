// ---------------------------------------------------------------------------
// Deprecation warning logic for renamed config fields
// ---------------------------------------------------------------------------
//
// Extracted from define_config.ts to reduce complexity and file length.
// ---------------------------------------------------------------------------

import { bold, dim } from '../utils/logger.js'

import type { DevToolbarOptions, ServerStatsConfig } from '../types.js'

// ---------------------------------------------------------------------------
// Simple deprecation entries (1:1 renames)
// ---------------------------------------------------------------------------

interface SimpleDeprecation {
  key: keyof ServerStatsConfig
  old: string
  newName: string
  before: (config: ServerStatsConfig) => string[]
  after: (config: ServerStatsConfig) => string[]
}

const SIMPLE_DEPRECATIONS: SimpleDeprecation[] = [
  {
    key: 'intervalMs',
    old: 'intervalMs',
    newName: 'pollInterval',
    before: (c) => [`intervalMs: ${c.intervalMs}`],
    after: (c) => [`pollInterval: ${c.intervalMs}`],
  },
  {
    key: 'transport',
    old: 'transport',
    newName: 'realtime',
    before: (c) => [`transport: '${c.transport}'`],
    after: (c) => [`realtime: ${c.transport === 'transmit'}`],
  },
  {
    key: 'endpoint',
    old: 'endpoint',
    newName: 'statsEndpoint',
    before: (c) => {
      const d = c.endpoint === false ? 'false' : `'${c.endpoint}'`
      return [`endpoint: ${d}`]
    },
    after: (c) => {
      const d = c.endpoint === false ? 'false' : `'${c.endpoint}'`
      return [`statsEndpoint: ${d}`]
    },
  },
  {
    key: 'shouldShow',
    old: 'shouldShow',
    newName: 'authorize',
    before: () => ['shouldShow: (ctx) => ...'],
    after: () => ['authorize: (ctx) => ...'],
  },
  {
    key: 'channelName',
    old: 'channelName',
    newName: 'advanced.channelName',
    before: (c) => [`channelName: '${c.channelName}'`],
    after: (c) => [`advanced: { channelName: '${c.channelName}' }`],
  },
  {
    key: 'skipInTest',
    old: 'skipInTest',
    newName: 'advanced.skipInTest',
    before: (c) => [`skipInTest: ${c.skipInTest}`],
    after: (c) => [`advanced: { skipInTest: ${c.skipInTest} }`],
  },
]

// ---------------------------------------------------------------------------
// devToolbar migration (complex — broken into helpers)
// ---------------------------------------------------------------------------

interface DeprecationEntry {
  old: string
  new: string
  before: string[]
  after: string[]
}

/** Fields to include in the "before" snapshot of devToolbar. */
const BEFORE_FIELDS: Array<{
  key: keyof DevToolbarOptions
  format: (v: unknown) => string
}> = [
  { key: 'enabled', format: (v) => `enabled: ${v}` },
  { key: 'dashboard', format: (v) => `dashboard: ${v}` },
  { key: 'dashboardPath', format: (v) => `dashboardPath: '${v}'` },
  { key: 'retentionDays', format: (v) => `retentionDays: ${v}` },
  { key: 'slowQueryThresholdMs', format: (v) => `slowQueryThresholdMs: ${v}` },
  { key: 'tracing', format: (v) => `tracing: ${v}` },
  { key: 'persistDebugData', format: (v) => `persistDebugData: ${JSON.stringify(v)}` },
  { key: 'maxQueries', format: (v) => `maxQueries: ${v}` },
  { key: 'maxEvents', format: (v) => `maxEvents: ${v}` },
  { key: 'maxEmails', format: (v) => `maxEmails: ${v}` },
  { key: 'maxTraces', format: (v) => `maxTraces: ${v}` },
  { key: 'renderer', format: (v) => `renderer: '${v}'` },
  { key: 'panes', format: () => `panes: [...]` },
  { key: 'excludeFromTracing', format: () => `excludeFromTracing: [...]` },
  { key: 'debugEndpoint', format: (v) => `debugEndpoint: '${v}'` },
  { key: 'dbPath', format: (v) => `dbPath: '${v}'` },
]

function buildBeforeParts(dt: DevToolbarOptions): string[] {
  const parts = ['devToolbar: {']
  for (const { key, format } of BEFORE_FIELDS) {
    if (dt[key] !== undefined) {
      parts.push(`  ${format(dt[key])},`)
    }
  }
  parts.push('}')
  return parts
}

function buildToolbarAfter(dt: DevToolbarOptions): string[] {
  const hasDetails =
    dt.slowQueryThresholdMs !== undefined ||
    dt.tracing !== undefined ||
    dt.persistDebugData !== undefined ||
    dt.panes !== undefined ||
    dt.excludeFromTracing !== undefined

  if (!dt.enabled) return []
  if (!hasDetails) return ['toolbar: true']

  const parts: string[] = ['toolbar: {']
  if (dt.slowQueryThresholdMs !== undefined) parts.push(`  slowQueryThreshold: ${dt.slowQueryThresholdMs},`)
  if (dt.tracing !== undefined) parts.push(`  tracing: ${dt.tracing},`)
  if (dt.persistDebugData !== undefined) parts.push(`  persist: ${JSON.stringify(dt.persistDebugData)},`)
  if (dt.panes !== undefined) parts.push(`  panes: [...],`)
  if (dt.excludeFromTracing !== undefined) parts.push(`  excludeFromTracing: [...],`)
  parts.push('}')
  return parts
}

function buildDashboardAfter(dt: DevToolbarOptions): string[] {
  if (!dt.dashboard) return []
  const hasDetails = dt.dashboardPath !== undefined || dt.retentionDays !== undefined
  if (!hasDetails) return ['dashboard: true']

  const parts: string[] = ['dashboard: {']
  if (dt.dashboardPath !== undefined) parts.push(`  path: '${dt.dashboardPath}',`)
  if (dt.retentionDays !== undefined) parts.push(`  retentionDays: ${dt.retentionDays},`)
  parts.push('}')
  return parts
}

function buildAdvancedAfter(dt: DevToolbarOptions): string[] {
  const parts: string[] = []
  if (dt.maxQueries !== undefined) parts.push(`  maxQueries: ${dt.maxQueries},`)
  if (dt.maxEvents !== undefined) parts.push(`  maxEvents: ${dt.maxEvents},`)
  if (dt.maxEmails !== undefined) parts.push(`  maxEmails: ${dt.maxEmails},`)
  if (dt.maxTraces !== undefined) parts.push(`  maxTraces: ${dt.maxTraces},`)
  if (dt.renderer !== undefined) parts.push(`  renderer: '${dt.renderer}',`)
  if (dt.debugEndpoint !== undefined) parts.push(`  debugEndpoint: '${dt.debugEndpoint}',`)
  if (dt.dbPath !== undefined) parts.push(`  dbPath: '${dt.dbPath}',`)
  if (parts.length === 0) return []
  return ['advanced: {', ...parts, '}']
}

function buildDevToolbarMigration(dt: DevToolbarOptions): DeprecationEntry {
  const afterParts = [
    ...buildToolbarAfter(dt),
    ...buildDashboardAfter(dt),
    ...buildAdvancedAfter(dt),
  ]

  const advancedPresent = buildAdvancedAfter(dt).length > 0
  const newLabel = [
    dt.enabled !== undefined ? 'toolbar' : '',
    dt.dashboard ? 'dashboard' : '',
    advancedPresent ? 'advanced' : '',
  ]
    .filter(Boolean)
    .join(' + ') || 'toolbar + dashboard + advanced'

  return {
    old: 'devToolbar',
    new: newLabel,
    before: buildBeforeParts(dt),
    after: afterParts,
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Detect deprecated config names and log a single grouped warning block.
 *
 * Only warns for fields the user **actually set** (not undefined).
 */
export function logDeprecationWarnings(config: ServerStatsConfig): void {
  const entries: DeprecationEntry[] = []

  for (const dep of SIMPLE_DEPRECATIONS) {
    if (config[dep.key] !== undefined) {
      entries.push({
        old: dep.old,
        new: dep.newName,
        before: dep.before(config),
        after: dep.after(config),
      })
    }
  }

  if (config.devToolbar !== undefined) {
    entries.push(buildDevToolbarMigration(config.devToolbar))
  }

  if (entries.length === 0) return

  const TAG = '\x1b[36m[ \x1b[1m\uD83D\uDD0D server-stats\x1b[0m\x1b[36m ]\x1b[0m'
  const lines: string[] = ['']
  lines.push(`${TAG} Some config options have been renamed — here's how to update:`)
  lines.push('')

  for (const entry of entries) {
    lines.push(`    ${dim(entry.old)} ${dim('\u2192')} ${bold(entry.new)}`)
    lines.push('')
    for (const line of entry.before) {
      lines.push(`      ${dim('before:')}  ${dim(line)}`)
    }
    for (const line of entry.after) {
      lines.push(`      ${dim('after:')}   ${line}`)
    }
    lines.push('')
  }

  lines.push(
    `    ${dim('No rush — the old names still work. They will be removed in the next major version.')}`
  )
  lines.push(
    `    ${dim('Update')} ${bold('config/server_stats.ts')} ${dim('when you get a chance.')}`
  )
  lines.push('')

  console.log(lines.join('\n'))
}

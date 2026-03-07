import { bold, dim, yellow } from './utils/logger.js'

import type { DevToolbarOptions, ResolvedServerStatsConfig, ServerStatsConfig } from './types.js'

/**
 * Resolve `toolbar`, `dashboard`, and `advanced` aliases into a
 * {@link DevToolbarOptions} object, merging with any existing
 * `devToolbar` settings the user provided.
 */
function resolveToolbarAliases(
  config: ServerStatsConfig,
  existing?: DevToolbarOptions
): DevToolbarOptions {
  const toolbar = config.toolbar
  const dashboard = config.dashboard
  const advanced = config.advanced

  // Start from existing devToolbar or a new object
  const result: DevToolbarOptions = { ...existing, enabled: existing?.enabled ?? false }

  // toolbar: true | ToolbarConfig enables the toolbar
  if (toolbar === true) {
    result.enabled = true
  } else if (toolbar && typeof toolbar === 'object') {
    result.enabled = true
    if (toolbar.slowQueryThreshold !== undefined)
      result.slowQueryThresholdMs = toolbar.slowQueryThreshold
    if (toolbar.tracing !== undefined) result.tracing = toolbar.tracing
    if (toolbar.persist !== undefined) result.persistDebugData = toolbar.persist
    if (toolbar.panes !== undefined) result.panes = toolbar.panes
    if (toolbar.excludeFromTracing !== undefined)
      result.excludeFromTracing = toolbar.excludeFromTracing
  } else if (toolbar === false) {
    result.enabled = false
  }

  // dashboard: true | DashboardConfig
  if (dashboard === true) {
    result.enabled = true // dashboard implies toolbar enabled
    result.dashboard = true
  } else if (dashboard && typeof dashboard === 'object') {
    result.enabled = true
    result.dashboard = true
    if (dashboard.path !== undefined) result.dashboardPath = dashboard.path
    if (dashboard.retentionDays !== undefined) result.retentionDays = dashboard.retentionDays
  }

  // advanced options
  if (advanced) {
    if (advanced.debugEndpoint !== undefined) result.debugEndpoint = advanced.debugEndpoint
    if (advanced.renderer !== undefined) result.renderer = advanced.renderer
    if (advanced.dbPath !== undefined) result.dbPath = advanced.dbPath
    if (advanced.persistPath !== undefined) {
      result.persistDebugData = advanced.persistPath
    }
    if (advanced.maxQueries !== undefined) result.maxQueries = advanced.maxQueries
    if (advanced.maxEvents !== undefined) result.maxEvents = advanced.maxEvents
    if (advanced.maxEmails !== undefined) result.maxEmails = advanced.maxEmails
    if (advanced.maxTraces !== undefined) result.maxTraces = advanced.maxTraces
  }

  return result
}

// ---------------------------------------------------------------------------
// Deprecation warnings
// ---------------------------------------------------------------------------

/**
 * A single before/after deprecation hint.
 */
interface DeprecationEntry {
  old: string
  new: string
  before: string[]
  after: string[]
}

/**
 * Build a concrete migration hint for `devToolbar` based on which sub-fields
 * the user actually configured. The result splits `devToolbar` into the new
 * `toolbar`, `dashboard`, and `advanced` config sections.
 */
function buildDevToolbarMigration(dt: DevToolbarOptions): DeprecationEntry {
  const beforeParts: string[] = []
  const afterParts: string[] = []

  // Reconstruct a readable "before" snapshot
  beforeParts.push('devToolbar: {')
  if (dt.enabled !== undefined) beforeParts.push(`  enabled: ${dt.enabled},`)
  if (dt.dashboard !== undefined) beforeParts.push(`  dashboard: ${dt.dashboard},`)
  if (dt.dashboardPath !== undefined) beforeParts.push(`  dashboardPath: '${dt.dashboardPath}',`)
  if (dt.retentionDays !== undefined) beforeParts.push(`  retentionDays: ${dt.retentionDays},`)
  if (dt.slowQueryThresholdMs !== undefined)
    beforeParts.push(`  slowQueryThresholdMs: ${dt.slowQueryThresholdMs},`)
  if (dt.tracing !== undefined) beforeParts.push(`  tracing: ${dt.tracing},`)
  if (dt.persistDebugData !== undefined)
    beforeParts.push(`  persistDebugData: ${JSON.stringify(dt.persistDebugData)},`)
  if (dt.maxQueries !== undefined) beforeParts.push(`  maxQueries: ${dt.maxQueries},`)
  if (dt.maxEvents !== undefined) beforeParts.push(`  maxEvents: ${dt.maxEvents},`)
  if (dt.maxEmails !== undefined) beforeParts.push(`  maxEmails: ${dt.maxEmails},`)
  if (dt.maxTraces !== undefined) beforeParts.push(`  maxTraces: ${dt.maxTraces},`)
  if (dt.renderer !== undefined) beforeParts.push(`  renderer: '${dt.renderer}',`)
  if (dt.panes !== undefined) beforeParts.push(`  panes: [...],`)
  if (dt.excludeFromTracing !== undefined) beforeParts.push(`  excludeFromTracing: [...],`)
  if (dt.debugEndpoint !== undefined) beforeParts.push(`  debugEndpoint: '${dt.debugEndpoint}',`)
  if (dt.dbPath !== undefined) beforeParts.push(`  dbPath: '${dt.dbPath}',`)
  beforeParts.push('}')

  // -- toolbar --
  const hasSlowQuery = dt.slowQueryThresholdMs !== undefined
  const hasTracing = dt.tracing !== undefined
  const hasPersist = dt.persistDebugData !== undefined
  const hasPanes = dt.panes !== undefined
  const hasExclude = dt.excludeFromTracing !== undefined
  const hasToolbarDetails = hasSlowQuery || hasTracing || hasPersist || hasPanes || hasExclude

  if (dt.enabled && hasToolbarDetails) {
    const parts: string[] = []
    if (hasSlowQuery) parts.push(`  slowQueryThreshold: ${dt.slowQueryThresholdMs},`)
    if (hasTracing) parts.push(`  tracing: ${dt.tracing},`)
    if (hasPersist) parts.push(`  persist: ${JSON.stringify(dt.persistDebugData)},`)
    if (hasPanes) parts.push(`  panes: [...],`)
    if (hasExclude) parts.push(`  excludeFromTracing: [...],`)
    afterParts.push('toolbar: {')
    afterParts.push(...parts)
    afterParts.push('}')
  } else if (dt.enabled) {
    afterParts.push('toolbar: true')
  }

  // -- dashboard --
  const hasCustomPath = dt.dashboardPath !== undefined
  const hasRetention = dt.retentionDays !== undefined
  const hasDashboardDetails = hasCustomPath || hasRetention

  if (dt.dashboard && hasDashboardDetails) {
    const parts: string[] = []
    if (hasCustomPath) parts.push(`  path: '${dt.dashboardPath}',`)
    if (hasRetention) parts.push(`  retentionDays: ${dt.retentionDays},`)
    afterParts.push('dashboard: {')
    afterParts.push(...parts)
    afterParts.push('}')
  } else if (dt.dashboard) {
    afterParts.push('dashboard: true')
  }

  // -- advanced --
  const advancedParts: string[] = []
  if (dt.maxQueries !== undefined) advancedParts.push(`  maxQueries: ${dt.maxQueries},`)
  if (dt.maxEvents !== undefined) advancedParts.push(`  maxEvents: ${dt.maxEvents},`)
  if (dt.maxEmails !== undefined) advancedParts.push(`  maxEmails: ${dt.maxEmails},`)
  if (dt.maxTraces !== undefined) advancedParts.push(`  maxTraces: ${dt.maxTraces},`)
  if (dt.renderer !== undefined) advancedParts.push(`  renderer: '${dt.renderer}',`)
  if (dt.debugEndpoint !== undefined) advancedParts.push(`  debugEndpoint: '${dt.debugEndpoint}',`)
  if (dt.dbPath !== undefined) advancedParts.push(`  dbPath: '${dt.dbPath}',`)
  if (advancedParts.length > 0) {
    afterParts.push('advanced: {')
    afterParts.push(...advancedParts)
    afterParts.push('}')
  }

  return {
    old: 'devToolbar',
    new:
      [
        dt.enabled !== undefined ? 'toolbar' : '',
        dt.dashboard ? 'dashboard' : '',
        advancedParts.length > 0 ? 'advanced' : '',
      ]
        .filter(Boolean)
        .join(' + ') || 'toolbar + dashboard + advanced',
    before: beforeParts,
    after: afterParts,
  }
}

/**
 * Detect deprecated config names and log a single grouped warning block.
 *
 * Only warns for fields the user **actually set** (not undefined).
 * The output is designed to be immediately actionable: each deprecated
 * field gets a before/after code snippet so users can copy-paste.
 */
function logDeprecationWarnings(config: ServerStatsConfig): void {
  const entries: DeprecationEntry[] = []

  // intervalMs -> pollInterval
  if (config.intervalMs !== undefined) {
    entries.push({
      old: 'intervalMs',
      new: 'pollInterval',
      before: [`intervalMs: ${config.intervalMs}`],
      after: [`pollInterval: ${config.intervalMs}`],
    })
  }

  // transport -> realtime
  if (config.transport !== undefined) {
    const realtimeValue = config.transport === 'transmit'
    entries.push({
      old: 'transport',
      new: 'realtime',
      before: [`transport: '${config.transport}'`],
      after: [`realtime: ${realtimeValue}`],
    })
  }

  // endpoint -> statsEndpoint
  if (config.endpoint !== undefined) {
    const endpointDisplay = config.endpoint === false ? 'false' : `'${config.endpoint}'`
    entries.push({
      old: 'endpoint',
      new: 'statsEndpoint',
      before: [`endpoint: ${endpointDisplay}`],
      after: [`statsEndpoint: ${endpointDisplay}`],
    })
  }

  // shouldShow -> authorize
  if (config.shouldShow !== undefined) {
    entries.push({
      old: 'shouldShow',
      new: 'authorize',
      before: ['shouldShow: (ctx) => ...'],
      after: ['authorize: (ctx) => ...'],
    })
  }

  // channelName -> advanced.channelName
  if (config.channelName !== undefined) {
    entries.push({
      old: 'channelName',
      new: 'advanced.channelName',
      before: [`channelName: '${config.channelName}'`],
      after: [`advanced: { channelName: '${config.channelName}' }`],
    })
  }

  // skipInTest -> advanced.skipInTest
  if (config.skipInTest !== undefined) {
    entries.push({
      old: 'skipInTest',
      new: 'advanced.skipInTest',
      before: [`skipInTest: ${config.skipInTest}`],
      after: [`advanced: { skipInTest: ${config.skipInTest} }`],
    })
  }

  // devToolbar -> toolbar + dashboard + advanced
  if (config.devToolbar !== undefined) {
    entries.push(buildDevToolbarMigration(config.devToolbar))
  }

  if (entries.length === 0) return

  // Build the warning block
  const TAG = '\x1b[36m[ \x1b[1m\uD83D\uDD0D server-stats\x1b[0m\x1b[36m ]\x1b[0m'
  const lines: string[] = []
  lines.push('')
  lines.push(`${TAG} ${yellow('\u26A0 deprecated config options detected:')}`)
  lines.push('')

  for (const entry of entries) {
    lines.push(`    ${bold(entry.old)} ${dim('\u2192')} ${bold(entry.new)}`)
    for (const line of entry.before) {
      lines.push(`      ${dim('before:')}  ${dim(line)}`)
    }
    for (const line of entry.after) {
      lines.push(`      ${yellow('after:')}   ${line}`)
    }
    lines.push('')
  }

  lines.push(
    `    ${dim('These old names still work but will be removed in the next major version.')}`
  )
  lines.push(
    `    ${dim('Update your')} ${bold('config/server_stats.ts')} ${dim('to silence these warnings.')}`
  )
  lines.push('')

  console.log(lines.join('\n'))
}

/**
 * Define the server stats configuration with full type safety.
 *
 * All top-level fields are optional. Sensible defaults are applied
 * for any omitted fields:
 *
 * | Field         | Default                        |
 * |---------------|--------------------------------|
 * | `intervalMs`  | `3000`                         |
 * | `transport`   | `'transmit'`                   |
 * | `channelName` | `'admin/server-stats'`         |
 * | `endpoint`    | `'/admin/api/server-stats'`    |
 * | `collectors`  | `'auto'`                       |
 * | `skipInTest`  | `true`                         |
 *
 * New simplified aliases (Phase 1) are also supported. When both the
 * old name and its alias are provided, the **new name takes precedence**.
 *
 * | Alias            | Resolves to      |
 * |------------------|------------------|
 * | `pollInterval`   | `intervalMs`     |
 * | `realtime`       | `transport`      |
 * | `statsEndpoint`  | `endpoint`       |
 * | `authorize`      | `shouldShow`     |
 * | `toolbar`        | `devToolbar`     |
 * | `dashboard`      | `devToolbar`     |
 * | `advanced`       | various          |
 *
 * This is the main entry point for configuring `adonisjs-server-stats`.
 * Call it in `config/server_stats.ts` and export the result as default.
 *
 * @example
 * ```ts
 * // config/server_stats.ts — minimal (all defaults)
 * import { defineConfig } from 'adonisjs-server-stats'
 *
 * export default defineConfig({})
 * ```
 *
 * @example
 * ```ts
 * // config/server_stats.ts — explicit collectors
 * import { defineConfig } from 'adonisjs-server-stats'
 * import { processCollector, httpCollector } from 'adonisjs-server-stats/collectors'
 *
 * export default defineConfig({
 *   intervalMs: 3000,
 *   transport: 'transmit',
 *   collectors: [processCollector(), httpCollector()],
 * })
 * ```
 *
 * @example
 * ```ts
 * // config/server_stats.ts — new simplified aliases
 * import { defineConfig } from 'adonisjs-server-stats'
 *
 * export default defineConfig({
 *   pollInterval: 3000,
 *   realtime: true,
 *   toolbar: true,
 *   dashboard: true,
 * })
 * ```
 */
export function defineConfig(config: ServerStatsConfig): ResolvedServerStatsConfig {
  // Resolve aliases (new names take precedence over old)
  const intervalMs = config.pollInterval ?? config.intervalMs ?? 3000

  let transport: 'transmit' | 'none'
  if (config.realtime !== undefined) {
    transport = config.realtime ? 'transmit' : 'none'
  } else {
    transport = config.transport ?? 'transmit'
  }

  const endpoint = config.statsEndpoint ?? config.endpoint ?? '/admin/api/server-stats'
  const shouldShow = config.authorize ?? config.shouldShow

  // Resolve toolbar/dashboard aliases into devToolbar
  let devToolbar = config.devToolbar
  if (
    config.toolbar !== undefined ||
    config.dashboard !== undefined ||
    config.advanced !== undefined
  ) {
    devToolbar = resolveToolbarAliases(config, devToolbar)
  }

  // Resolve advanced.channelName, advanced.skipInTest etc
  const channelName = config.advanced?.channelName ?? config.channelName ?? 'admin/server-stats'
  const skipInTest = config.advanced?.skipInTest ?? config.skipInTest ?? true

  // Log friendly deprecation warnings for any old config names the user set
  logDeprecationWarnings(config)

  return {
    intervalMs,
    transport,
    channelName,
    endpoint,
    collectors: config.collectors ?? 'auto',
    skipInTest,
    onStats: config.onStats,
    devToolbar,
    shouldShow,
  }
}

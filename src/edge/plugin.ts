import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Template } from 'edge.js'

import { log } from '../utils/logger.js'
import { loadTransmitClient } from '../utils/transmit_client.js'

import type { ServerStatsConfig } from '../types.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(DIR, rel), 'utf-8')

/**
 * Edge plugin that registers the `@serverStats()` tag.
 *
 * - Mounts `views/` as the `ss` Edge disk for partials
 * - Reads CSS/JS client assets from `client/`
 * - Pre-renders the stats-bar template once at boot (via `Template` directly
 *   to avoid the `#executePlugins` recursion from `edge.renderSync`)
 * - Registers `@serverStats()` tag that outputs the pre-rendered HTML
 *
 * Usage in the provider's `boot()` method:
 * ```ts
 * edge.use(edgePluginServerStats(config))
 * ```
 *
 * Usage in Edge templates:
 * ```edge
 * @serverStats()
 * ```
 */
export function edgePluginServerStats(config: ServerStatsConfig) {
  return (edge: any) => {
    // Mount Edge views under the `ss` disk (needed for @include resolution)
    edge.mount('ss', join(DIR, 'views'))

    // Read client assets once at boot
    const css = read('../styles/stats-bar.css')
    const js = read('client/stats-bar.js')

    const endpoint =
      typeof config.endpoint === 'string' ? config.endpoint : '/admin/api/server-stats'
    const intervalMs = config.intervalMs || 3000
    const showDebug = !!config.devToolbar?.enabled

    // Determine which collectors are configured
    const collectorNames = new Set((config.collectors ?? []).map((c) => c.name))
    const hasProcess = collectorNames.has('process')
    const hasSystem = collectorNames.has('system')
    const hasHttp = collectorNames.has('http')
    const hasDb = collectorNames.has('db_pool')
    const hasRedis = collectorNames.has('redis')
    const hasQueue = collectorNames.has('queue')
    const hasApp = collectorNames.has('app')
    const hasLog = collectorNames.has('log')

    // Badge groups for the Edge template — only include configured collectors
    // Memory badges come from two collectors: process (HEAP, RSS) and system (SYS)
    const memoryBadges: { id: string; label: string }[] = []
    if (hasProcess) {
      memoryBadges.push({ id: 'mem', label: 'HEAP' }, { id: 'rss', label: 'RSS' })
    }
    if (hasSystem) {
      memoryBadges.push({ id: 'sys', label: 'SYS' })
    }

    const groups = [
      // Process (only if process collector is configured)
      ...(hasProcess
        ? [
            [
              { id: 'node', label: 'NODE' },
              { id: 'up', label: 'UP' },
              { id: 'cpu', label: 'CPU' },
              { id: 'evt', label: 'EVT' },
            ],
          ]
        : []),
      // Memory (HEAP/RSS from process, SYS from system)
      ...(memoryBadges.length > 0 ? [memoryBadges] : []),
      // HTTP (only if http collector is configured)
      ...(hasHttp
        ? [
            [
              { id: 'rps', label: 'REQ/s' },
              { id: 'avg', label: 'AVG' },
              { id: 'err', label: 'ERR' },
              { id: 'conn', label: 'CONN' },
            ],
          ]
        : []),
      // DB (only if db_pool collector is configured)
      ...(hasDb ? [[{ id: 'db', label: 'DB' }]] : []),
      // Redis (only if redis collector is configured)
      ...(hasRedis
        ? [
            [
              { id: 'redis', label: 'REDIS' },
              { id: 'rmem', label: 'MEM' },
              { id: 'rkeys', label: 'KEYS' },
              { id: 'rhit', label: 'HIT' },
            ],
          ]
        : []),
      // Queue (only if queue collector is configured)
      ...(hasQueue
        ? [
            [
              { id: 'q', label: 'Q' },
              { id: 'workers', label: 'WORKERS' },
            ],
          ]
        : []),
      // App (only if app collector is configured)
      ...(hasApp
        ? [
            [
              { id: 'users', label: 'USERS' },
              { id: 'hooks', label: 'HOOKS' },
              { id: 'mail', label: 'MAIL' },
            ],
          ]
        : []),
      // Logs (only if log collector is configured)
      ...(hasLog
        ? [
            [
              { id: 'logerr', label: 'LOG ERR' },
              { id: 'lograte', label: 'LOG/m' },
            ],
          ]
        : []),
      // Debug (conditional)
      ...(showDebug ? [[{ id: 'dbg-queries', label: 'QRY' }]] : []),
    ]

    const state: Record<string, any> = {
      css,
      js,
      endpoint,
      intervalMs,
      showDebug,
      hasProcess,
      hasRedis,
      groups,
    }

    if (showDebug) {
      const debugEndpoint = config.devToolbar?.debugEndpoint || '/admin/api/debug'
      state.debugCss = read('../styles/debug-panel.css')
      state.debugJs = read('client/debug-panel.js')
      state.debugEndpoint = debugEndpoint
      state.logsEndpoint = debugEndpoint + '/logs'
      state.customPanes = config.devToolbar?.panes || []
      state.showTracing = !!config.devToolbar?.tracing
      state.dashboardPath = config.devToolbar?.dashboard
        ? config.devToolbar.dashboardPath || '/__stats'
        : null
      state.transmitClient = loadTransmitClient(join(process.cwd(), 'package.json'))
      if (!state.transmitClient) {
        log.info('@adonisjs/transmit-client not found — debug panel will use polling')
      }
    }

    // Pre-render via Template directly — bypasses edge.createRenderer() which
    // would re-run #executePlugins and cause infinite recursion.
    const template = new Template(edge.compiler, edge.globals, {}, edge.processor)
    const html = template.render<string>('ss::stats-bar', state)
    const escaped = JSON.stringify(html)

    // Track whether shouldShow is configured (controls render-time guard)
    const hasShouldShow = !!config.shouldShow

    edge.registerTag({
      tagName: 'serverStats',
      block: false,
      seekable: true,
      compile(_parser: any, buffer: any, token: any) {
        if (hasShouldShow) {
          // Guard: call the lazy __ssShowFn at render time (after auth middleware has run)
          buffer.writeStatement(
            `if (typeof state.__ssShowFn === 'function' ? state.__ssShowFn() : false) {`,
            token.filename,
            token.loc.start.line
          )
          buffer.outputExpression(escaped, token.filename, token.loc.start.line, false)
          buffer.writeStatement(`}`, token.filename, -1)
        } else {
          // No shouldShow configured — always render
          buffer.outputExpression(escaped, token.filename, token.loc.start.line, false)
        }
      },
    })
  }
}

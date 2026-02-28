import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Template } from 'edge.js'

import { log } from '../utils/logger.js'
import { loadTransmitClient } from '../utils/transmit_client.js'

import type { ServerStatsConfig } from '../types.js'

/** Minimal interface for the Edge.js engine used in the plugin. */
interface EdgeEngine {
  mount(name: string, path: string): void
  compiler: unknown
  globals: Record<string, unknown>
  processor: unknown
  registerTag(tag: EdgeTagDefinition): void
}

/** Minimal interface for an Edge tag definition. */
interface EdgeTagDefinition {
  tagName: string
  block: boolean
  seekable: boolean
  compile(parser: EdgeParser, buffer: EdgeBuffer, token: EdgeToken): void
}

/** Minimal interface for the Edge tag compiler parser. */
interface EdgeParser {
  // Parser is unused in our compile but required by the tag signature
}

/** Minimal interface for the Edge tag compiler buffer. */
interface EdgeBuffer {
  writeStatement(statement: string, filename: string, line: number): void
  outputExpression(expression: string, filename: string, line: number, escape: boolean): void
}

/** Minimal interface for the Edge tag compiler token. */
interface EdgeToken {
  filename: string
  loc: { start: { line: number } }
}

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
  return (edge: EdgeEngine) => {
    // Mount Edge views under the `ss` disk (needed for @include resolution)
    edge.mount('ss', join(DIR, 'views'))

    // Read client assets once at boot
    const css = read('../styles/stats-bar.css')
    const js = read('client/stats-bar.js')

    const endpoint =
      typeof config.endpoint === 'string' ? config.endpoint : '/admin/api/server-stats'
    const intervalMs = config.intervalMs || 3000
    const showDebug = !!config.devToolbar?.enabled

    const channelName = config.channelName || 'admin/server-stats'

    const barConfig: Record<string, unknown> = {
      endpoint,
      pollInterval: intervalMs,
      channelName,
      showDebug,
      ...(showDebug && {
        debugEndpoint: config.devToolbar?.debugEndpoint || '/admin/api/debug',
        dashboardPath: config.devToolbar?.dashboard
          ? config.devToolbar.dashboardPath || '/__stats'
          : null,
      }),
    }

    // Always try to load the Transmit client — both the stats bar and the
    // debug panel use it for live (SSE) updates.
    const transmitClient = loadTransmitClient(join(process.cwd(), 'package.json'))
    if (!transmitClient) {
      log.info('@adonisjs/transmit-client not found — will use polling')
    }

    const state: Record<string, unknown> = {
      css,
      js,
      barConfig,
      showDebug,
      transmitClient,
    }

    if (showDebug) {
      state.debugCss = read('../styles/debug-panel.css')
    }

    // Pre-render via Template directly — bypasses edge.createRenderer() which
    // would re-run #executePlugins and cause infinite recursion.
    const template = new Template(
      edge.compiler as ConstructorParameters<typeof Template>[0],
      edge.globals,
      {},
      edge.processor as ConstructorParameters<typeof Template>[3]
    )
    const html = template.render<string>('ss::stats-bar', state)
    const escaped = JSON.stringify(html)

    // Track whether shouldShow is configured (controls render-time guard)
    const hasShouldShow = !!config.shouldShow

    edge.registerTag({
      tagName: 'serverStats',
      block: false,
      seekable: true,
      compile(_parser: EdgeParser, buffer: EdgeBuffer, token: EdgeToken) {
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

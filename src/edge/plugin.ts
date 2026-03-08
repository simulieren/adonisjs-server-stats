import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Template } from 'edge.js'

import { log } from '../utils/logger.js'
import { loadTransmitClient } from '../utils/transmit_client.js'

import type { ResolvedServerStatsConfig } from '../types.js'

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

/** Build concatenated CSS from component, utility, and stats-bar stylesheets. */
function buildCss(): string {
  const componentsCss = read('../styles/components.css')
  const utilitiesCss = read('../styles/utilities.css')
  return componentsCss + '\n' + utilitiesCss + '\n' + read('../styles/stats-bar.css')
}

/** Resolve the client asset directory based on renderer config. */
function resolveClientDir(config: ResolvedServerStatsConfig): string {
  const renderer = config.devToolbar?.renderer || 'preact'
  return renderer === 'vue' ? 'client-vue' : 'client'
}

/** Build the bar configuration object for the stats bar client. */
function buildBarConfig(config: ResolvedServerStatsConfig): Record<string, unknown> {
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint : '/admin/api/server-stats'
  const showDebug = !!config.devToolbar?.enabled
  const result: Record<string, unknown> = {
    endpoint,
    pollInterval: config.intervalMs || 3000,
    channelName: config.channelName || 'admin/server-stats',
    showDebug,
  }
  if (showDebug) {
    addDebugBarConfig(config, result)
  }
  return result
}

/** Add debug-specific fields to bar config. */
function addDebugBarConfig(
  config: ResolvedServerStatsConfig,
  result: Record<string, unknown>
): void {
  result.debugEndpoint = config.devToolbar?.debugEndpoint || '/admin/api/debug'
  result.dashboardPath = config.devToolbar?.dashboard
    ? config.devToolbar.dashboardPath || '/__stats'
    : null
}

/** Build template state for the Edge stats-bar partial. */
function buildTemplateState(
  config: ResolvedServerStatsConfig,
  clientDir: string
): Record<string, unknown> {
  const showDebug = !!config.devToolbar?.enabled
  const transmitClient = loadTransmitClient(join(process.cwd(), 'package.json'))
  if (!transmitClient) {
    log.info('@adonisjs/transmit-client not found — will use polling')
  }
  const state: Record<string, unknown> = {
    css: buildCss(),
    js: read(clientDir + '/stats-bar.js'),
    barConfig: buildBarConfig(config),
    showDebug,
    transmitClient,
  }
  if (showDebug) {
    state.debugCss = read('../styles/debug-panel.css')
    state.debugDeferredJs = read(clientDir + '/debug-panel-deferred.js')
  }
  return state
}

/**
 * Edge plugin that registers the `@serverStats()` tag.
 */
export function edgePluginServerStats(config: ResolvedServerStatsConfig) {
  return (edge: EdgeEngine) => {
    edge.mount('ss', join(DIR, 'views'))
    const clientDir = resolveClientDir(config)
    const state = buildTemplateState(config, clientDir)
    const template = new Template(
      edge.compiler as ConstructorParameters<typeof Template>[0],
      edge.globals,
      {},
      edge.processor as ConstructorParameters<typeof Template>[3]
    )
    const html = template.render<string>('ss::stats-bar', state)
    const escaped = JSON.stringify(html)
    const hasShouldShow = !!config.shouldShow

    edge.registerTag({
      tagName: 'serverStats',
      block: false,
      seekable: true,
      compile(_parser: EdgeParser, buffer: EdgeBuffer, token: EdgeToken) {
        if (hasShouldShow) {
          buffer.writeStatement(
            "if (typeof state.__ssShowFn === 'function' ? state.__ssShowFn() : false) {",
            token.filename,
            token.loc.start.line
          )
          buffer.outputExpression(escaped, token.filename, token.loc.start.line, false)
          buffer.writeStatement('}', token.filename, -1)
        } else {
          buffer.outputExpression(escaped, token.filename, token.loc.start.line, false)
        }
      },
    })
  }
}

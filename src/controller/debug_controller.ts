import { readFile, stat } from 'node:fs/promises'

import type { DebugStore } from '../debug/debug_store.js'
import type { ServerStatsConfig } from '../types.js'
import type { HttpContext } from '@adonisjs/core/http'

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

export default class DebugController {
  private logPath: string

  constructor(
    private store: DebugStore,
    logPath: string,
    private serverConfig?: ServerStatsConfig
  ) {
    this.logPath = logPath
  }

  async config({ response }: HttpContext) {
    const cfg = this.serverConfig
    const toolbarConfig = cfg?.devToolbar

    // Derive feature flags from the actual config
    const collectorNames = new Set((cfg?.collectors ?? []).map((c) => c.name))

    const features = {
      statsBar: true,
      debugPanel: !!toolbarConfig?.enabled,
      dashboard: !!toolbarConfig?.dashboard,
      tracing: !!toolbarConfig?.tracing,
      process: collectorNames.has('process'),
      system: collectorNames.has('system'),
      http: collectorNames.has('http'),
      db: collectorNames.has('db_pool'),
      redis: collectorNames.has('redis'),
      queues: collectorNames.has('queue'),
      cache: collectorNames.has('redis'),
      app: collectorNames.has('app'),
      log: collectorNames.has('log'),
      emails: !!toolbarConfig?.enabled,
    }

    // Custom panes from config
    const customPanes = toolbarConfig?.panes ?? []

    // Endpoint paths
    const debugEndpoint = toolbarConfig?.debugEndpoint ?? '/admin/api/debug'
    const dashboardPath = toolbarConfig?.dashboardPath ?? '/__stats'
    const statsEndpoint =
      typeof cfg?.endpoint === 'string' ? cfg.endpoint : '/admin/api/server-stats'

    const endpoints = {
      stats: statsEndpoint,
      debug: debugEndpoint,
      dashboard: dashboardPath,
    }

    // Transmit config
    const transmit = {
      channelName: cfg?.channelName ?? 'admin/server-stats',
    }

    return response.json({ features, customPanes, endpoints, transmit })
  }

  async queries({ response }: HttpContext) {
    const queries = this.store.queries.getLatest(500)
    const summary = this.store.queries.getSummary()
    return response.json({ queries, summary })
  }

  async events({ response }: HttpContext) {
    const events = this.store.events.getLatest(200)
    return response.json({ events, total: this.store.events.getTotalCount() })
  }

  async routes({ response }: HttpContext) {
    const routes = this.store.routes.getRoutes()
    return response.json({ routes, total: this.store.routes.getRouteCount() })
  }

  async emails({ response }: HttpContext) {
    const emails = this.store.emails.getLatest(100)
    // Strip html/text from list response to keep it lightweight
    const stripped = emails.map(({ html, text, ...rest }) => rest)
    return response.json({ emails: stripped, total: this.store.emails.getTotalCount() })
  }

  async emailPreview({ params, response }: HttpContext) {
    const id = Number(params.id)
    const html = this.store.emails.getEmailHtml(id)
    if (!html) {
      return response.notFound({ error: 'Email not found' })
    }
    return response.header('Content-Type', 'text/html; charset=utf-8').send(html)
  }

  async traces({ response }: HttpContext) {
    if (!this.store.traces) {
      return response.json({ traces: [], total: 0 })
    }
    const traces = this.store.traces.getLatest(100)
    // Strip spans from list view to keep it lightweight
    const list = traces.map(({ spans, warnings, ...rest }) => ({
      ...rest,
      warningCount: warnings.length,
    }))
    return response.json({ traces: list, total: this.store.traces.getTotalCount() })
  }

  async traceDetail({ params, response }: HttpContext) {
    if (!this.store.traces) {
      return response.notFound({ error: 'Tracing not enabled' })
    }
    const id = Number(params.id)
    const trace = this.store.traces.getTrace(id)
    if (!trace) {
      return response.notFound({ error: 'Trace not found' })
    }
    return response.json(trace)
  }

  async logs({ response }: HttpContext) {
    try {
      const stats = await stat(this.logPath)

      // Only read last 256KB to keep response fast
      const maxBytes = 256 * 1024
      let content: string
      if (stats.size > maxBytes) {
        const { createReadStream } = await import('node:fs')
        const stream = createReadStream(this.logPath, {
          start: stats.size - maxBytes,
          encoding: 'utf-8',
        })
        const chunks: string[] = []
        for await (const chunk of stream) {
          chunks.push(chunk as string)
        }
        content = chunks.join('')
        // Skip first potentially incomplete line
        const firstNewline = content.indexOf('\n')
        if (firstNewline !== -1) content = content.slice(firstNewline + 1)
      } else {
        content = await readFile(this.logPath, 'utf-8')
      }

      const entries = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            const entry = JSON.parse(line)
            return {
              ...entry,
              levelName: LEVEL_NAMES[entry.level] || 'unknown',
              timestamp: new Date(entry.time).toISOString(),
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)

      return response.json(entries)
    } catch {
      return response.json([])
    }
  }
}

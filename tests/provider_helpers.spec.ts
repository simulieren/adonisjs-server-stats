import { test } from '@japa/runner'

// ── email_helpers ──────────────────────────────────────────────────
import { capHtmlSize, MAIL_STATUS_MAP, buildEmailPayload } from '../src/provider/email_helpers.js'

test.group('capHtmlSize', () => {
  test('returns null for falsy input', ({ assert }) => {
    assert.isNull(capHtmlSize(null))
    assert.isNull(capHtmlSize(undefined))
    assert.isNull(capHtmlSize(''))
    assert.isNull(capHtmlSize(0))
  })

  test('returns null for non-string input', ({ assert }) => {
    assert.isNull(capHtmlSize(42))
    assert.isNull(capHtmlSize(true))
  })

  test('returns string as-is when under limit', ({ assert }) => {
    assert.equal(capHtmlSize('hello'), 'hello')
    assert.equal(capHtmlSize('<p>short</p>'), '<p>short</p>')
  })

  test('truncates string exceeding limit', ({ assert }) => {
    const result = capHtmlSize('abcdef', 3)
    assert.equal(result, 'abc\n<!-- truncated -->')
  })

  test('uses default limit of 50000', ({ assert }) => {
    const short = 'x'.repeat(50_000)
    assert.equal(capHtmlSize(short), short)
    const long = 'x'.repeat(50_001)
    assert.isTrue((capHtmlSize(long) as string).endsWith('<!-- truncated -->'))
  })
})

test.group('MAIL_STATUS_MAP', () => {
  test('has 5 entries', ({ assert }) => {
    assert.equal(MAIL_STATUS_MAP.length, 5)
  })

  test('maps mail:sending to sending', ({ assert }) => {
    assert.deepEqual(MAIL_STATUS_MAP[0], ['mail:sending', 'sending'])
  })

  test('maps queued:mail:error to failed', ({ assert }) => {
    assert.deepEqual(MAIL_STATUS_MAP[4], ['queued:mail:error', 'failed'])
  })
})

test.group('buildEmailPayload', () => {
  test('extracts nested message fields', ({ assert }) => {
    const result = buildEmailPayload(
      {
        message: {
          from: 'a@b.com',
          to: 'c@d.com',
          subject: 'Hello',
          html: '<b>Hi</b>',
        },
        mailerName: 'smtp',
      },
      'sent',
      'tag1'
    )
    assert.equal(result._t, 'tag1')
    assert.equal(result.from, 'a@b.com')
    assert.equal(result.to, 'c@d.com')
    assert.equal(result.subject, 'Hello')
    assert.equal(result.status, 'sent')
    assert.equal(result.mailer, 'smtp')
  })

  test('handles flat message shape', ({ assert }) => {
    const result = buildEmailPayload(
      { from: 'x@y.com', to: 'z@w.com', subject: 'Test' },
      'sending',
      'tag2'
    )
    assert.equal(result.from, 'x@y.com')
    assert.equal(result.to, 'z@w.com')
    assert.equal(result.subject, 'Test')
  })

  test('uses defaults for missing fields', ({ assert }) => {
    const result = buildEmailPayload(null, 'queued', 'tag3')
    assert.equal(result.from, 'unknown')
    assert.equal(result.to, 'unknown')
    assert.equal(result.subject, '(no subject)')
    assert.equal(result.mailer, 'unknown')
    assert.isNull(result.messageId)
    assert.equal(result.attachmentCount, 0)
  })

  test('extracts messageId from response', ({ assert }) => {
    const result = buildEmailPayload(
      { response: { messageId: 'abc123' } },
      'sent',
      'tag4'
    )
    assert.equal(result.messageId, 'abc123')
  })
})

// ── auth_middleware_detector ────────────────────────────────────────
import {
  detectAuthMiddlewareInSource,
  buildAuthMiddlewareWarning,
} from '../src/provider/auth_middleware_detector.js'

test.group('detectAuthMiddlewareInSource', () => {
  test('returns empty array for empty source', ({ assert }) => {
    assert.deepEqual(detectAuthMiddlewareInSource(''), [])
  })

  test('detects auth middleware in server.use()', ({ assert }) => {
    const source = `
      server.use([
        () => import('#middleware/auth_middleware'),
      ])
    `
    assert.deepEqual(detectAuthMiddlewareInSource(source), ['#middleware/auth_middleware'])
  })

  test('detects silent_auth middleware', ({ assert }) => {
    const source = `
      router.use([
        () => import('#middleware/silent_auth_middleware'),
      ])
    `
    assert.deepEqual(detectAuthMiddlewareInSource(source), ['#middleware/silent_auth_middleware'])
  })

  test('ignores initialize_auth middleware', ({ assert }) => {
    const source = `
      server.use([
        () => import('#middleware/initialize_auth_middleware'),
      ])
    `
    assert.deepEqual(detectAuthMiddlewareInSource(source), [])
  })

  test('detects multiple auth middleware', ({ assert }) => {
    const source = `
      server.use([
        () => import('#middleware/initialize_auth_middleware'),
        () => import('#middleware/auth_middleware'),
      ])
      router.use([
        () => import('#middleware/silent_auth_middleware'),
      ])
    `
    const result = detectAuthMiddlewareInSource(source)
    assert.deepEqual(result, [
      '#middleware/auth_middleware',
      '#middleware/silent_auth_middleware',
    ])
  })

  test('returns empty for source without use() blocks', ({ assert }) => {
    const source = `const x = 1; const y = 2;`
    assert.deepEqual(detectAuthMiddlewareInSource(source), [])
  })
})

test.group('buildAuthMiddlewareWarning', () => {
  test('builds warning lines for detected middleware', ({ assert }) => {
    const found = ['#middleware/auth']
    const lines = buildAuthMiddlewareWarning(
      found,
      (s) => `[dim]${s}[/dim]`,
      (s) => `[bold]${s}[/bold]`
    )
    assert.isTrue(lines.some((l) => l.includes('#middleware/auth')))
    assert.isTrue(lines.some((l) => l.includes('shouldShow')))
    assert.isTrue(lines.some((l) => l.includes('option 1')))
    assert.isTrue(lines.some((l) => l.includes('option 2')))
  })
})

// ── diagnostics ────────────────────────────────────────────────────
import { buildDiagnostics } from '../src/provider/diagnostics.js'

test.group('buildDiagnostics', () => {
  test('returns full diagnostics with null config', ({ assert }) => {
    const result = buildDiagnostics({
      intervalId: null,
      dashboardBroadcastTimer: null,
      debugBroadcastTimer: null,
      flushTimer: null,
      dashboardStoreReady: false,
      transmitAvailable: false,
      transmitChannels: [],
      prometheusActive: false,
      pinoHookActive: false,
      edgePluginActive: false,
      emailBridgeActive: false,
      hasCacheCollector: false,
      hasQueueCollector: false,
      config: null,
    })
    assert.isFalse(result.timers.collectionInterval.active)
    assert.equal(result.config.intervalMs, 0)
    assert.isFalse(result.devToolbar.enabled)
  })

  test('returns correct config diagnostics', ({ assert }) => {
    const result = buildDiagnostics({
      intervalId: 1 as unknown as ReturnType<typeof setInterval>,
      dashboardBroadcastTimer: null,
      debugBroadcastTimer: null,
      flushTimer: null,
      dashboardStoreReady: false,
      transmitAvailable: true,
      transmitChannels: ['ch1'],
      prometheusActive: true,
      pinoHookActive: true,
      edgePluginActive: true,
      emailBridgeActive: true,
      hasCacheCollector: true,
      hasQueueCollector: true,
      config: {
        intervalMs: 5000,
        transport: 'transmit',
        channelName: 'stats',
        endpoint: '/api/stats',
        skipInTest: true,
        onStats: () => {},
        shouldShow: () => true,
        devToolbar: {
          enabled: true,
          maxQueries: 100,
          maxEvents: 50,
          maxEmails: 25,
          maxTraces: 50,
          slowQueryThresholdMs: 200,
          tracing: false,
          dashboard: true,
          dashboardPath: '/dash',
          retentionDays: 14,
          dbPath: '/tmp/db.sqlite',
          persistDebugData: true,
          debugEndpoint: '/debug',
          renderer: 'preact',
          excludeFromTracing: ['/health'],
          panes: [{ name: 'test' }],
        },
      },
    })
    assert.isTrue(result.timers.collectionInterval.active)
    assert.equal(result.config.intervalMs, 5000)
    assert.isTrue(result.integrations.prometheus.active)
    assert.isTrue(result.integrations.pinoHook.active)
    assert.isTrue(result.devToolbar.enabled)
    assert.equal(result.devToolbar.maxQueries, 100)
    assert.equal(result.devToolbar.dashboardPath, '/dash')
  })
})

// ── pino_hook ──────────────────────────────────────────────────────
import { findPinoStreamSymbol, wrapWriteMethod } from '../src/provider/pino_hook.js'

test.group('findPinoStreamSymbol', () => {
  test('finds symbol by description', ({ assert }) => {
    const sym = Symbol('pino.stream')
    const obj = { [sym]: 'stream-value' }
    const found = findPinoStreamSymbol(obj)
    assert.equal(found, sym)
  })

  test('returns undefined when no matching symbol', ({ assert }) => {
    const obj = { [Symbol('other')]: 'val' }
    assert.isUndefined(findPinoStreamSymbol(obj))
  })

  test('returns undefined for empty object', ({ assert }) => {
    assert.isUndefined(findPinoStreamSymbol({}))
  })
})

test.group('wrapWriteMethod', () => {
  test('ingests valid JSON log entries', ({ assert }) => {
    const ingested: Record<string, unknown>[] = []
    const chunks: string[] = []
    const stream = {
      write(chunk: string) {
        chunks.push(chunk)
        return true
      },
    }
    wrapWriteMethod(stream, (entry) => ingested.push(entry))
    stream.write(JSON.stringify({ level: 30, msg: 'hello' }))
    assert.equal(ingested.length, 1)
    assert.equal(ingested[0].msg, 'hello')
    assert.equal(chunks.length, 1)
  })

  test('passes through non-JSON data without ingesting', ({ assert }) => {
    const ingested: Record<string, unknown>[] = []
    const chunks: string[] = []
    const stream = {
      write(chunk: string) {
        chunks.push(chunk)
        return true
      },
    }
    wrapWriteMethod(stream, (entry) => ingested.push(entry))
    stream.write('not json')
    assert.equal(ingested.length, 0)
    assert.equal(chunks.length, 1)
  })

  test('handles Uint8Array chunks', ({ assert }) => {
    const ingested: Record<string, unknown>[] = []
    const stream = {
      write(_chunk: unknown) {
        return true
      },
    }
    wrapWriteMethod(stream, (entry) => ingested.push(entry))
    const buf = new TextEncoder().encode(JSON.stringify({ level: 40, msg: 'warn' }))
    stream.write(buf)
    assert.equal(ingested.length, 1)
    assert.equal(ingested[0].msg, 'warn')
  })

  test('skips entries without level number', ({ assert }) => {
    const ingested: Record<string, unknown>[] = []
    const stream = {
      write(_chunk: unknown) {
        return true
      },
    }
    wrapWriteMethod(stream, (entry) => ingested.push(entry))
    stream.write(JSON.stringify({ msg: 'no level' }))
    assert.equal(ingested.length, 0)
  })
})

// ── shutdown_helpers ───────────────────────────────────────────────
import { clearAllTimers } from '../src/provider/shutdown_helpers.js'

test.group('clearAllTimers', () => {
  test('clears all provided timers', ({ assert }) => {
    const timers = {
      intervalId: setInterval(() => {}, 100000),
      flushTimer: setInterval(() => {}, 100000),
      dashboardBroadcastTimer: setInterval(() => {}, 100000),
      debugBroadcastTimer: setTimeout(() => {}, 100000),
    }
    clearAllTimers(timers)
    assert.isNull(timers.intervalId)
    assert.isNull(timers.flushTimer)
    assert.isNull(timers.dashboardBroadcastTimer)
    assert.isNull(timers.debugBroadcastTimer)
  })

  test('handles null timers gracefully', ({ assert }) => {
    const timers = {
      intervalId: null,
      flushTimer: null,
      dashboardBroadcastTimer: null,
      debugBroadcastTimer: null,
    }
    clearAllTimers(timers)
    assert.isNull(timers.intervalId)
  })
})

// ── dashboard_setup ────────────────────────────────────────────────
import {
  classifyDashboardError,
  buildExcludedPrefixes,
  resolveToolbarConfig,
} from '../src/provider/dashboard_setup.js'

test.group('classifyDashboardError', () => {
  test('returns missing-dep for better-sqlite3 error', ({ assert }) => {
    assert.equal(
      classifyDashboardError(new Error('Cannot find module better-sqlite3')),
      'missing-dep'
    )
  })

  test('returns missing-dep for MODULE_NOT_FOUND code', ({ assert }) => {
    const err = new Error('fail')
    ;(err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND'
    assert.equal(classifyDashboardError(err), 'missing-dep')
  })

  test('returns timeout for timed out error', ({ assert }) => {
    assert.equal(classifyDashboardError(new Error('timed out')), 'timeout')
  })

  test('returns unknown for other errors', ({ assert }) => {
    assert.equal(classifyDashboardError(new Error('something else')), 'unknown')
  })

  test('returns unknown for null', ({ assert }) => {
    assert.equal(classifyDashboardError(null), 'unknown')
  })
})

test.group('buildExcludedPrefixes', () => {
  test('includes both debug and stats endpoints by default', ({ assert }) => {
    const result = buildExcludedPrefixes({}, '/api/stats')
    assert.include(result, '/admin/api/debug')
    assert.include(result, '/api/stats')
  })

  test('uses custom debugEndpoint', ({ assert }) => {
    const result = buildExcludedPrefixes({ debugEndpoint: '/custom/debug' }, '/api/stats')
    assert.include(result, '/custom/debug')
  })

  test('uses custom excludeFromTracing', ({ assert }) => {
    const result = buildExcludedPrefixes(
      { excludeFromTracing: ['/health'] },
      '/api/stats'
    )
    assert.include(result, '/health')
    assert.include(result, '/api/stats')
  })

  test('handles false statsEndpoint', ({ assert }) => {
    const result = buildExcludedPrefixes({}, false)
    assert.include(result, '/admin/api/debug')
  })
})

test.group('resolveToolbarConfig', () => {
  test('fills in defaults for missing fields', ({ assert }) => {
    const result = resolveToolbarConfig({ enabled: true })
    assert.equal(result.maxQueries, 500)
    assert.equal(result.maxEvents, 200)
    assert.equal(result.maxEmails, 100)
    assert.equal(result.slowQueryThresholdMs, 100)
    assert.equal(result.tracing, true)
    assert.equal(result.dashboard, false)
    assert.equal(result.dashboardPath, '/__stats')
  })

  test('preserves explicit values', ({ assert }) => {
    const result = resolveToolbarConfig({
      enabled: true,
      maxQueries: 100,
      dashboard: true,
    })
    assert.equal(result.maxQueries, 100)
    assert.equal(result.dashboard, true)
    assert.equal(result.maxEvents, 200)
  })
})

import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test.group('defineConfig | default resolution', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('returns all documented defaults when called with empty object', ({ assert }) => {
    const resolved = defineConfig({})

    assert.equal(resolved.intervalMs, 3000)
    assert.equal(resolved.transport, 'transmit')
    assert.equal(resolved.channelName, 'admin/server-stats')
    assert.equal(resolved.endpoint, '/admin/api/server-stats')
    assert.equal(resolved.collectors, 'auto')
    assert.equal(resolved.skipInTest, true)
    assert.equal(resolved.verbose, false)
  })

  test('shouldShow is undefined by default', ({ assert }) => {
    const resolved = defineConfig({})
    assert.isUndefined(resolved.shouldShow)
  })

  test('devToolbar is undefined by default', ({ assert }) => {
    const resolved = defineConfig({})
    assert.isUndefined(resolved.devToolbar)
  })

  test('onStats is undefined by default', ({ assert }) => {
    const resolved = defineConfig({})
    assert.isUndefined(resolved.onStats)
  })
})

// ---------------------------------------------------------------------------
// Alias precedence
// ---------------------------------------------------------------------------

test.group('defineConfig | alias precedence', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('pollInterval overrides intervalMs', ({ assert }) => {
    const resolved = defineConfig({ pollInterval: 5000, intervalMs: 1000 })
    assert.equal(resolved.intervalMs, 5000)
  })

  test('pollInterval is used when intervalMs is not set', ({ assert }) => {
    const resolved = defineConfig({ pollInterval: 7000 })
    assert.equal(resolved.intervalMs, 7000)
  })

  test('intervalMs is used as fallback when pollInterval is not set', ({ assert }) => {
    const resolved = defineConfig({ intervalMs: 2000 })
    assert.equal(resolved.intervalMs, 2000)
  })

  test('realtime overrides transport', ({ assert }) => {
    const resolved = defineConfig({ realtime: false, transport: 'transmit' })
    assert.equal(resolved.transport, 'none')
  })

  test('realtime true overrides transport none', ({ assert }) => {
    const resolved = defineConfig({ realtime: true, transport: 'none' })
    assert.equal(resolved.transport, 'transmit')
  })

  test('statsEndpoint overrides endpoint', ({ assert }) => {
    const resolved = defineConfig({ statsEndpoint: '/new-stats', endpoint: '/old-stats' })
    assert.equal(resolved.endpoint, '/new-stats')
  })

  test('statsEndpoint is used when endpoint is not set', ({ assert }) => {
    const resolved = defineConfig({ statsEndpoint: '/my-stats' })
    assert.equal(resolved.endpoint, '/my-stats')
  })

  test('endpoint is used as fallback when statsEndpoint is not set', ({ assert }) => {
    const resolved = defineConfig({ endpoint: '/legacy-stats' })
    assert.equal(resolved.endpoint, '/legacy-stats')
  })

  test('authorize overrides shouldShow', ({ assert }) => {
    const authorizeFn = () => true
    const shouldShowFn = () => false
    const resolved = defineConfig({ authorize: authorizeFn, shouldShow: shouldShowFn } as unknown as Parameters<typeof defineConfig>[0])
    assert.strictEqual(resolved.shouldShow, authorizeFn)
  })

  test('authorize is used when shouldShow is not set', ({ assert }) => {
    const authorizeFn = () => true
    const resolved = defineConfig({ authorize: authorizeFn } as unknown as Parameters<typeof defineConfig>[0])
    assert.strictEqual(resolved.shouldShow, authorizeFn)
  })

  test('shouldShow is used as fallback when authorize is not set', ({ assert }) => {
    const shouldShowFn = () => false
    const resolved = defineConfig({ shouldShow: shouldShowFn } as unknown as Parameters<typeof defineConfig>[0])
    assert.strictEqual(resolved.shouldShow, shouldShowFn)
  })
})

// ---------------------------------------------------------------------------
// realtime boolean mapping
// ---------------------------------------------------------------------------

test.group('defineConfig | realtime boolean mapping', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('realtime true maps to transmit', ({ assert }) => {
    const resolved = defineConfig({ realtime: true })
    assert.equal(resolved.transport, 'transmit')
  })

  test('realtime false maps to none', ({ assert }) => {
    const resolved = defineConfig({ realtime: false })
    assert.equal(resolved.transport, 'none')
  })

  test('undefined realtime falls back to transport value', ({ assert }) => {
    const resolved = defineConfig({ transport: 'none' })
    assert.equal(resolved.transport, 'none')
  })

  test('undefined realtime and undefined transport defaults to transmit', ({ assert }) => {
    const resolved = defineConfig({})
    assert.equal(resolved.transport, 'transmit')
  })
})

// ---------------------------------------------------------------------------
// resolveToolbarAliases
// ---------------------------------------------------------------------------

test.group('defineConfig | resolveToolbarAliases — toolbar', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('toolbar: true sets devToolbar.enabled to true', ({ assert }) => {
    const resolved = defineConfig({ toolbar: true })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
  })

  test('toolbar: false sets devToolbar.enabled to false', ({ assert }) => {
    const resolved = defineConfig({ toolbar: false })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, false)
  })

  test('toolbar object enables toolbar and maps slowQueryThreshold', ({ assert }) => {
    const resolved = defineConfig({ toolbar: { slowQueryThreshold: 50 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.slowQueryThresholdMs, 50)
  })

  test('toolbar object maps tracing field', ({ assert }) => {
    const resolved = defineConfig({ toolbar: { tracing: true } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.tracing, true)
  })

  test('toolbar object maps persist field', ({ assert }) => {
    const resolved = defineConfig({ toolbar: { persist: true } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.persistDebugData, true)
  })

  test('toolbar object maps panes field', ({ assert }) => {
    const panes = [{ name: 'test', endpoint: '/test', columns: [] }]
    const resolved = defineConfig({ toolbar: { panes } } as unknown as Parameters<typeof defineConfig>[0])
    assert.isDefined(resolved.devToolbar)
    assert.deepEqual(resolved.devToolbar!.panes, panes)
  })

  test('toolbar object maps excludeFromTracing field', ({ assert }) => {
    const excludes = ['/health', '/ping']
    const resolved = defineConfig({ toolbar: { excludeFromTracing: excludes } })
    assert.isDefined(resolved.devToolbar)
    assert.deepEqual(resolved.devToolbar!.excludeFromTracing, excludes)
  })
})

test.group('defineConfig | resolveToolbarAliases — dashboard', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('dashboard: true enables toolbar and dashboard', ({ assert }) => {
    const resolved = defineConfig({ dashboard: true })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.dashboard, true)
  })

  test('dashboard object sets path and retentionDays', ({ assert }) => {
    const resolved = defineConfig({ dashboard: { path: '/x', retentionDays: 3 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.dashboard, true)
    assert.equal(resolved.devToolbar!.dashboardPath, '/x')
    assert.equal(resolved.devToolbar!.retentionDays, 3)
  })

  test('dashboard object with only path sets dashboard true and dashboardPath', ({ assert }) => {
    const resolved = defineConfig({ dashboard: { path: '/dashboard' } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.dashboard, true)
    assert.equal(resolved.devToolbar!.dashboardPath, '/dashboard')
    assert.isUndefined(resolved.devToolbar!.retentionDays)
  })

  test('dashboard object with only retentionDays sets dashboard true', ({ assert }) => {
    const resolved = defineConfig({ dashboard: { retentionDays: 14 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.dashboard, true)
    assert.equal(resolved.devToolbar!.retentionDays, 14)
    assert.isUndefined(resolved.devToolbar!.dashboardPath)
  })
})

test.group('defineConfig | resolveToolbarAliases — advanced', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('advanced.debugEndpoint maps to devToolbar.debugEndpoint', ({ assert }) => {
    const resolved = defineConfig({ advanced: { debugEndpoint: '/debug' } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.debugEndpoint, '/debug')
  })

  test('advanced.renderer maps to devToolbar.renderer', ({ assert }) => {
    const resolved = defineConfig({ advanced: { renderer: 'vue' } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.renderer, 'vue')
  })

  test('advanced.dbPath maps to devToolbar.dbPath', ({ assert }) => {
    const resolved = defineConfig({ advanced: { dbPath: '/tmp/test.sqlite3' } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.dbPath, '/tmp/test.sqlite3')
  })

  test('advanced.persistPath maps to devToolbar.persistDebugData', ({ assert }) => {
    const resolved = defineConfig({ advanced: { persistPath: '/data/persist.json' } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.persistDebugData, '/data/persist.json')
  })

  test('advanced.maxQueries maps to devToolbar.maxQueries', ({ assert }) => {
    const resolved = defineConfig({ advanced: { maxQueries: 1000 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.maxQueries, 1000)
  })

  test('advanced.maxEvents maps to devToolbar.maxEvents', ({ assert }) => {
    const resolved = defineConfig({ advanced: { maxEvents: 300 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.maxEvents, 300)
  })

  test('advanced.maxEmails maps to devToolbar.maxEmails', ({ assert }) => {
    const resolved = defineConfig({ advanced: { maxEmails: 50 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.maxEmails, 50)
  })

  test('advanced.maxTraces maps to devToolbar.maxTraces', ({ assert }) => {
    const resolved = defineConfig({ advanced: { maxTraces: 500 } })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.maxTraces, 500)
  })
})

// ---------------------------------------------------------------------------
// advanced.channelName and advanced.skipInTest precedence
// ---------------------------------------------------------------------------

test.group('defineConfig | advanced.channelName and advanced.skipInTest precedence', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('advanced.channelName overrides top-level channelName', ({ assert }) => {
    const resolved = defineConfig({
      channelName: 'old-channel',
      advanced: { channelName: 'new-channel' },
    })
    assert.equal(resolved.channelName, 'new-channel')
  })

  test('top-level channelName is used when advanced.channelName is not set', ({ assert }) => {
    const resolved = defineConfig({ channelName: 'custom-channel' })
    assert.equal(resolved.channelName, 'custom-channel')
  })

  test('advanced.skipInTest overrides top-level skipInTest', ({ assert }) => {
    const resolved = defineConfig({
      skipInTest: true,
      advanced: { skipInTest: false },
    })
    assert.equal(resolved.skipInTest, false)
  })

  test('top-level skipInTest is used when advanced.skipInTest is not set', ({ assert }) => {
    const resolved = defineConfig({ skipInTest: false })
    assert.equal(resolved.skipInTest, false)
  })

  test('defaults apply when neither top-level nor advanced set channelName', ({ assert }) => {
    const resolved = defineConfig({})
    assert.equal(resolved.channelName, 'admin/server-stats')
  })

  test('defaults apply when neither top-level nor advanced set skipInTest', ({ assert }) => {
    const resolved = defineConfig({})
    assert.equal(resolved.skipInTest, true)
  })
})

// ---------------------------------------------------------------------------
// Deprecation warnings
// ---------------------------------------------------------------------------

test.group('defineConfig | deprecation warnings', (group) => {
  let originalLog: typeof console.log
  let logCalls: string[]

  group.each.setup(() => {
    originalLog = console.log
    logCalls = []
    console.log = (...args: unknown[]) => {
      logCalls.push(args.map(String).join(' '))
    }
  })

  group.each.teardown(() => {
    console.log = originalLog
  })

  test('intervalMs triggers deprecation warning', ({ assert }) => {
    defineConfig({ intervalMs: 5000 })
    assert.isTrue(logCalls.length > 0, 'expected console.log to be called')
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('intervalMs'), 'expected warning to mention intervalMs')
    assert.isTrue(output.includes('pollInterval'), 'expected warning to mention pollInterval')
  })

  test('transport triggers deprecation warning', ({ assert }) => {
    defineConfig({ transport: 'none' })
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('transport'), 'expected warning to mention transport')
    assert.isTrue(output.includes('realtime'), 'expected warning to mention realtime')
  })

  test('endpoint triggers deprecation warning', ({ assert }) => {
    defineConfig({ endpoint: '/stats' })
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('endpoint'), 'expected warning to mention endpoint')
    assert.isTrue(output.includes('statsEndpoint'), 'expected warning to mention statsEndpoint')
  })

  test('shouldShow triggers deprecation warning', ({ assert }) => {
    defineConfig({ shouldShow: () => true } as unknown as Parameters<typeof defineConfig>[0])
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('shouldShow'), 'expected warning to mention shouldShow')
    assert.isTrue(output.includes('authorize'), 'expected warning to mention authorize')
  })

  test('channelName triggers deprecation warning', ({ assert }) => {
    defineConfig({ channelName: 'custom' })
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('channelName'), 'expected warning to mention channelName')
    assert.isTrue(
      output.includes('advanced.channelName'),
      'expected warning to mention advanced.channelName'
    )
  })

  test('skipInTest triggers deprecation warning', ({ assert }) => {
    defineConfig({ skipInTest: false })
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('skipInTest'), 'expected warning to mention skipInTest')
    assert.isTrue(
      output.includes('advanced.skipInTest'),
      'expected warning to mention advanced.skipInTest'
    )
  })

  test('devToolbar triggers deprecation warning', ({ assert }) => {
    defineConfig({ devToolbar: { enabled: true } })
    const output = logCalls.join('\n')
    assert.isTrue(output.includes('devToolbar'), 'expected warning to mention devToolbar')
  })

  test('no warnings when only new alias names are used', ({ assert }) => {
    defineConfig({
      pollInterval: 3000,
      realtime: true,
      statsEndpoint: '/stats',
      authorize: (() => true) as unknown as (...args: unknown[]) => boolean,
      toolbar: true,
      dashboard: true,
      advanced: { skipInTest: false, channelName: 'ch' },
    })
    assert.equal(logCalls.length, 0, 'expected no console.log calls for new alias names')
  })

  test('no warnings when called with empty config', ({ assert }) => {
    defineConfig({})
    assert.equal(logCalls.length, 0, 'expected no console.log calls for empty config')
  })

  test('multiple deprecated fields trigger a single grouped warning', ({ assert }) => {
    defineConfig({ intervalMs: 1000, transport: 'none', channelName: 'ch' })
    // logDeprecationWarnings builds all entries and logs them in a single console.log call
    assert.equal(logCalls.length, 1, 'expected exactly one console.log call for grouped warning')
    const output = logCalls[0]
    assert.isTrue(output.includes('intervalMs'))
    assert.isTrue(output.includes('transport'))
    assert.isTrue(output.includes('channelName'))
  })
})

// ---------------------------------------------------------------------------
// endpoint: false
// ---------------------------------------------------------------------------

test.group('defineConfig | endpoint false', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('endpoint: false is preserved in resolved config', ({ assert }) => {
    const resolved = defineConfig({ endpoint: false })
    assert.equal(resolved.endpoint, false)
  })

  test('statsEndpoint: false is preserved in resolved config', ({ assert }) => {
    const resolved = defineConfig({ statsEndpoint: false })
    assert.equal(resolved.endpoint, false)
  })

  test('statsEndpoint: false overrides endpoint string', ({ assert }) => {
    const resolved = defineConfig({ statsEndpoint: false, endpoint: '/stats' })
    assert.equal(resolved.endpoint, false)
  })
})

// ---------------------------------------------------------------------------
// Combined aliases
// ---------------------------------------------------------------------------

test.group('defineConfig | combined toolbar + dashboard + advanced', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('toolbar + dashboard + advanced all set together', ({ assert }) => {
    const resolved = defineConfig({
      toolbar: { slowQueryThreshold: 75, tracing: true },
      dashboard: { path: '/my-dashboard', retentionDays: 5 },
      advanced: {
        debugEndpoint: '/api/debug',
        renderer: 'vue',
        dbPath: '/data/stats.db',
        persistPath: '/data/persist',
        maxQueries: 2000,
        maxEvents: 400,
        maxEmails: 200,
        maxTraces: 600,
        channelName: 'stats-channel',
        skipInTest: false,
      },
    })

    // toolbar fields
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.slowQueryThresholdMs, 75)
    assert.equal(resolved.devToolbar!.tracing, true)

    // dashboard fields
    assert.equal(resolved.devToolbar!.dashboard, true)
    assert.equal(resolved.devToolbar!.dashboardPath, '/my-dashboard')
    assert.equal(resolved.devToolbar!.retentionDays, 5)

    // advanced fields
    assert.equal(resolved.devToolbar!.debugEndpoint, '/api/debug')
    assert.equal(resolved.devToolbar!.renderer, 'vue')
    assert.equal(resolved.devToolbar!.dbPath, '/data/stats.db')
    assert.equal(resolved.devToolbar!.persistDebugData, '/data/persist')
    assert.equal(resolved.devToolbar!.maxQueries, 2000)
    assert.equal(resolved.devToolbar!.maxEvents, 400)
    assert.equal(resolved.devToolbar!.maxEmails, 200)
    assert.equal(resolved.devToolbar!.maxTraces, 600)

    // advanced.channelName and skipInTest resolve to top-level
    assert.equal(resolved.channelName, 'stats-channel')
    assert.equal(resolved.skipInTest, false)
  })

  test('toolbar aliases merge with existing devToolbar', ({ assert }) => {
    const resolved = defineConfig({
      devToolbar: { enabled: false, maxQueries: 100 },
      toolbar: true,
      advanced: { maxEvents: 999 },
    })

    // toolbar: true should override devToolbar.enabled
    assert.equal(resolved.devToolbar!.enabled, true)
    // devToolbar.maxQueries should be preserved from the existing devToolbar spread
    assert.equal(resolved.devToolbar!.maxQueries, 100)
    // advanced.maxEvents should be applied
    assert.equal(resolved.devToolbar!.maxEvents, 999)
  })

  test('dashboard: true with toolbar: false still enables toolbar via dashboard', ({ assert }) => {
    const resolved = defineConfig({ toolbar: false, dashboard: true })
    assert.isDefined(resolved.devToolbar)
    // toolbar: false sets enabled=false, but dashboard: true re-enables it
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.dashboard, true)
  })
})

// ---------------------------------------------------------------------------
// verbose and onStats passthrough
// ---------------------------------------------------------------------------

test.group('defineConfig | verbose and onStats passthrough', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('verbose: true is passed through', ({ assert }) => {
    const resolved = defineConfig({ verbose: true })
    assert.equal(resolved.verbose, true)
  })

  test('verbose defaults to false', ({ assert }) => {
    const resolved = defineConfig({})
    assert.equal(resolved.verbose, false)
  })

  test('onStats callback is passed through', ({ assert }) => {
    const callback = () => {}
    const resolved = defineConfig({ onStats: callback })
    assert.strictEqual(resolved.onStats, callback)
  })

  test('collectors array is passed through', ({ assert }) => {
    const collectors: Array<{ name: string; collect: () => Promise<Record<string, unknown>> }> = [{ name: 'test', collect: async () => ({}) }]
    const resolved = defineConfig({ collectors })
    assert.strictEqual(resolved.collectors, collectors)
  })
})

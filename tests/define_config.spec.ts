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
// resolveToolbarAliases — toolbar
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

// ---------------------------------------------------------------------------
// resolveToolbarAliases — dashboard
// ---------------------------------------------------------------------------

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

test.group('defineConfig | combined toolbar + dashboard + advanced (all set)', (group) => {
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

    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.slowQueryThresholdMs, 75)
    assert.equal(resolved.devToolbar!.tracing, true)
    assert.equal(resolved.devToolbar!.dashboard, true)
    assert.equal(resolved.devToolbar!.dashboardPath, '/my-dashboard')
    assert.equal(resolved.devToolbar!.retentionDays, 5)
    assert.equal(resolved.devToolbar!.debugEndpoint, '/api/debug')
    assert.equal(resolved.devToolbar!.renderer, 'vue')
    assert.equal(resolved.devToolbar!.dbPath, '/data/stats.db')
    assert.equal(resolved.devToolbar!.persistDebugData, '/data/persist')
    assert.equal(resolved.devToolbar!.maxQueries, 2000)
    assert.equal(resolved.devToolbar!.maxEvents, 400)
    assert.equal(resolved.devToolbar!.maxEmails, 200)
    assert.equal(resolved.devToolbar!.maxTraces, 600)
    assert.equal(resolved.channelName, 'stats-channel')
    assert.equal(resolved.skipInTest, false)
  })
})

test.group('defineConfig | combined toolbar + dashboard + advanced (merge)', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
  })

  test('toolbar aliases merge with existing devToolbar', ({ assert }) => {
    const resolved = defineConfig({
      devToolbar: { enabled: false, maxQueries: 100 },
      toolbar: true,
      advanced: { maxEvents: 999 },
    })

    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.maxQueries, 100)
    assert.equal(resolved.devToolbar!.maxEvents, 999)
  })

  test('dashboard: true with toolbar: false still enables toolbar via dashboard', ({ assert }) => {
    const resolved = defineConfig({ toolbar: false, dashboard: true })
    assert.isDefined(resolved.devToolbar)
    assert.equal(resolved.devToolbar!.enabled, true)
    assert.equal(resolved.devToolbar!.dashboard, true)
  })
})

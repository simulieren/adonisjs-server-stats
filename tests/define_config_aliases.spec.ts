import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'

// ---------------------------------------------------------------------------
// Alias precedence — polling and transport
// ---------------------------------------------------------------------------

test.group('defineConfig | alias precedence (polling)', (group) => {
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
})

test.group('defineConfig | alias precedence (transport & endpoint)', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
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
})

test.group('defineConfig | alias precedence (authorize & shouldShow)', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
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
// Deprecation warnings — individual fields
// ---------------------------------------------------------------------------

test.group('defineConfig | deprecation warnings (individual)', (group) => {
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
})

// ---------------------------------------------------------------------------
// Deprecation warnings — channelName, skipInTest, devToolbar
// ---------------------------------------------------------------------------

test.group('defineConfig | deprecation warnings (channelName, skipInTest, devToolbar)', (group) => {
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
})

// ---------------------------------------------------------------------------
// Deprecation warnings — clean and grouped
// ---------------------------------------------------------------------------

test.group('defineConfig | deprecation warnings (clean & grouped)', (group) => {
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
    assert.equal(logCalls.length, 1, 'expected exactly one console.log call for grouped warning')
    const output = logCalls[0]
    assert.isTrue(output.includes('intervalMs'))
    assert.isTrue(output.includes('transport'))
    assert.isTrue(output.includes('channelName'))
  })
})

// ---------------------------------------------------------------------------
// resolveToolbarAliases — advanced
// ---------------------------------------------------------------------------

test.group('defineConfig | resolveToolbarAliases advanced (debugEndpoint & renderer)', (group) => {
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
})

test.group('defineConfig | resolveToolbarAliases advanced (buffer limits)', (group) => {
  let originalLog: typeof console.log
  group.setup(() => {
    originalLog = console.log
    console.log = () => {}
  })
  group.teardown(() => {
    console.log = originalLog
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

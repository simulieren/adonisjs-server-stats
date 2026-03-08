import { test } from '@japa/runner'

import { DebugStore } from '../src/debug/debug_store.js'

import type { DevToolbarConfig } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEmitter() {
  const handlers: Record<string, Function[]> = {}
  return {
    on(event: string, handler: Function) {
      ;(handlers[event] ??= []).push(handler)
    },
    off(event: string, handler: Function) {
      const arr = handlers[event]
      if (arr) {
        const i = arr.indexOf(handler)
        if (i >= 0) arr.splice(i, 1)
      }
    },
    emit(event: string | ((...args: unknown[]) => unknown), data?: unknown) {
      const name = typeof event === 'string' ? event : event?.name || 'unknown'
      handlers[name]?.forEach((h) => h(data))
      return undefined
    },
    handlers,
  }
}

function baseConfig(overrides: Partial<DevToolbarConfig> = {}): DevToolbarConfig {
  return {
    enabled: true,
    maxQueries: 100,
    maxEvents: 100,
    maxEmails: 100,
    slowQueryThresholdMs: 100,
    persistDebugData: false,
    tracing: false,
    maxTraces: 50,
    dashboard: false,
    dashboardPath: '/__stats',
    retentionDays: 7,
    dbPath: ':memory:',
    debugEndpoint: '/__debug',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

test.group('DebugStore | Constructor', () => {
  test('creates all collectors and traces is null when tracing=false', ({ assert }) => {
    const store = new DebugStore(baseConfig({ tracing: false }))

    assert.isDefined(store.queries)
    assert.isDefined(store.events)
    assert.isDefined(store.emails)
    assert.isDefined(store.routes)
    assert.isNull(store.traces)
  })

  test('creates TraceCollector when tracing=true', ({ assert }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))

    assert.isDefined(store.queries)
    assert.isDefined(store.events)
    assert.isDefined(store.emails)
    assert.isDefined(store.routes)
    assert.isNotNull(store.traces)

    store.traces?.stop()
  })
})

// ---------------------------------------------------------------------------
// start() — router integration
// ---------------------------------------------------------------------------

test.group('DebugStore | start() (router)', () => {
  test('all collectors receive emitter and routes inspected when router has toJSON', async ({
    assert,
  }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()

    const mockRouter = {
      toJSON() {
        return {
          root: [
            {
              methods: ['GET'],
              pattern: '/users',
              name: 'users.index',
              handler: 'UsersController.index',
              middleware: [],
            },
          ],
        }
      },
    }

    await store.start(emitter, mockRouter)

    const routes = store.routes.getRoutes()
    assert.isAbove(routes.length, 0)
    assert.equal(routes[0].pattern, '/users')

    assert.isTrue(
      Array.isArray(emitter.handlers['db:query']),
      'db:query handlers should be registered'
    )

    assert.isTrue(
      Array.isArray(emitter.handlers['mail:sending']),
      'mail:sending handler should be registered'
    )

    store.stop()
  })
})

// ---------------------------------------------------------------------------
// start() — edge cases
// ---------------------------------------------------------------------------

test.group('DebugStore | start() (edge cases)', () => {
  test('start() works without router', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()

    await store.start(emitter, null)

    assert.lengthOf(store.routes.getRoutes(), 0)

    store.stop()
  })

  test('start() works with router that has no toJSON', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()

    await store.start(emitter, { someOtherMethod: () => {} })

    assert.lengthOf(store.routes.getRoutes(), 0)

    store.stop()
  })
})

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

test.group('DebugStore | stop()', () => {
  test('all collectors stopped after stop()', async ({ assert }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()

    await store.start(emitter, null)

    store.stop()

    emitter.emit('db:query', {
      sql: 'SELECT 1',
      bindings: [],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    assert.lengthOf(store.queries.getQueries(), 0)
  })
})

// ---------------------------------------------------------------------------
// getBufferStats()
// ---------------------------------------------------------------------------

test.group('DebugStore | getBufferStats()', () => {
  test('returns correct shape with all keys', ({ assert }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))

    const stats = store.getBufferStats()

    assert.properties(stats, ['queries', 'events', 'emails', 'traces'])
    assert.properties(stats.queries, ['current', 'max'])
    assert.properties(stats.events, ['current', 'max'])
    assert.properties(stats.emails, ['current', 'max'])
    assert.properties(stats.traces, ['current', 'max'])

    assert.equal(stats.queries.current, 0)
    assert.equal(stats.queries.max, 100)
    assert.equal(stats.events.current, 0)
    assert.equal(stats.events.max, 100)
    assert.equal(stats.emails.current, 0)
    assert.equal(stats.emails.max, 100)
    assert.equal(stats.traces.current, 0)
    assert.equal(stats.traces.max, 50)

    store.traces?.stop()
  })

  test('traces returns {current:0, max:0} when tracing disabled', ({ assert }) => {
    const store = new DebugStore(baseConfig({ tracing: false }))

    const stats = store.getBufferStats()

    assert.deepEqual(stats.traces, { current: 0, max: 0 })
  })
})

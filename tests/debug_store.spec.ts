import { test } from '@japa/runner'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

function tempFilePath(): string {
  return join(tmpdir(), `debug-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
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

    // Clean up trace collector to restore console.warn
    store.traces?.stop()
  })
})

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

test.group('DebugStore | start()', () => {
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

    // Verify routes were inspected
    const routes = store.routes.getRoutes()
    assert.isAbove(routes.length, 0)
    assert.equal(routes[0].pattern, '/users')

    // Verify emitter handlers registered - db:query should have handlers from QueryCollector and TraceCollector
    assert.isTrue(
      Array.isArray(emitter.handlers['db:query']),
      'db:query handlers should be registered'
    )

    // Verify mail handlers registered
    assert.isTrue(
      Array.isArray(emitter.handlers['mail:sending']),
      'mail:sending handler should be registered'
    )

    store.stop()
  })

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

    // After stop, emitting db:query should not add queries
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

// ---------------------------------------------------------------------------
// onNewItem()
// ---------------------------------------------------------------------------

test.group('DebugStore | onNewItem()', () => {
  test('callback fires for queries, events, and emails with correct type strings', async ({
    assert,
  }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    const received: string[] = []
    store.onNewItem((type) => received.push(type))

    // Emit a db:query
    emitter.emit('db:query', {
      sql: 'SELECT 1',
      bindings: [],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    // Emit an app event (EventCollector intercepts all emits via monkey-patching)
    emitter.emit('user:registered', { id: 1 })

    // Emit a mail:sending event
    emitter.emit('mail:sending', {
      message: {
        from: 'test@example.com',
        to: 'user@example.com',
        subject: 'Hello',
      },
      mailerName: 'smtp',
    })

    assert.isTrue(received.includes('query'), 'should receive query type')
    assert.isTrue(received.includes('event'), 'should receive event type')
    assert.isTrue(received.includes('email'), 'should receive email type')

    store.onNewItem(null)
    store.stop()
  })

  test('onNewItem(null) unregisters all callbacks', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    const received: string[] = []
    store.onNewItem((type) => received.push(type))

    // Verify callback works
    emitter.emit('db:query', {
      sql: 'SELECT 1',
      bindings: [],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    const countBefore = received.length
    assert.isAbove(countBefore, 0, 'should have received at least one callback')

    // Unregister
    store.onNewItem(null)

    // Emit more events
    emitter.emit('db:query', {
      sql: 'SELECT 2',
      bindings: [],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    assert.equal(received.length, countBefore, 'no new callbacks should fire after unregistering')

    store.stop()
  })
})

// ---------------------------------------------------------------------------
// Integration: emit → collector
// ---------------------------------------------------------------------------

test.group('DebugStore | Integration', () => {
  test('emit db:query appears in queries collector', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    emitter.emit('db:query', {
      sql: 'INSERT INTO users (name) VALUES (?)',
      bindings: ['Alice'],
      duration: 3.2,
      method: 'insert',
      model: 'User',
      connection: 'postgres',
      inTransaction: true,
    })

    const queries = store.queries.getQueries()
    assert.lengthOf(queries, 1)
    assert.equal(queries[0].sql, 'INSERT INTO users (name) VALUES (?)')
    assert.deepEqual(queries[0].bindings, ['Alice'])
    assert.equal(queries[0].method, 'insert')
    assert.equal(queries[0].model, 'User')
    assert.equal(queries[0].connection, 'postgres')
    assert.isTrue(queries[0].inTransaction)

    store.stop()
  })

  test('emit app event appears in events collector', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    emitter.emit('order:placed', { orderId: 42 })

    const events = store.events.getEvents()
    assert.isAbove(events.length, 0)

    const orderEvent = events.find((e) => e.event === 'order:placed')
    assert.isDefined(orderEvent)
    assert.isNotNull(orderEvent!.data)

    store.stop()
  })

  test('emit mail:sending appears in emails collector', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    emitter.emit('mail:sending', {
      message: {
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<h1>Welcome!</h1>',
      },
      mailerName: 'ses',
    })

    const emails = store.emails.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].subject, 'Welcome')
    assert.equal(emails[0].mailer, 'ses')
    assert.equal(emails[0].status, 'sending')

    store.stop()
  })
})

// ---------------------------------------------------------------------------
// saveToDisk / loadFromDisk
// ---------------------------------------------------------------------------

test.group('DebugStore | saveToDisk / loadFromDisk', (group) => {
  const filesToCleanUp: string[] = []

  group.teardown(async () => {
    for (const f of filesToCleanUp) {
      try {
        await unlink(f)
      } catch {
        // ignore
      }
      try {
        await unlink(f + '.tmp')
      } catch {
        // ignore
      }
    }
  })

  test('round-trip: save data, create fresh store, load, verify all data restored', async ({
    assert,
  }) => {
    const filePath = tempFilePath()
    filesToCleanUp.push(filePath)

    // Create store with data
    const store1 = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()
    await store1.start(emitter, null)

    // Add query
    emitter.emit('db:query', {
      sql: 'SELECT * FROM products',
      bindings: [],
      duration: 5.0,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    // Add event
    emitter.emit('test:save', { key: 'value' })

    // Add email
    emitter.emit('mail:sending', {
      message: {
        from: 'a@b.com',
        to: 'c@d.com',
        subject: 'Persist test',
      },
      mailerName: 'smtp',
    })

    // Verify data exists before saving
    assert.isAbove(store1.queries.getQueries().length, 0)
    assert.isAbove(store1.events.getEvents().length, 0)
    assert.isAbove(store1.emails.getEmails().length, 0)

    store1.stop()

    await store1.saveToDisk(filePath)

    // Create fresh store and load
    const store2 = new DebugStore(baseConfig({ tracing: true }))
    await store2.loadFromDisk(filePath)

    // Verify queries restored
    const queries = store2.queries.getQueries()
    assert.isAbove(queries.length, 0)
    assert.equal(queries[0].sql, 'SELECT * FROM products')

    // Verify events restored
    const events = store2.events.getEvents()
    assert.isAbove(events.length, 0)

    // Verify emails restored
    const emails = store2.emails.getEmails()
    assert.isAbove(emails.length, 0)
    assert.equal(emails[0].subject, 'Persist test')

    store2.traces?.stop()
  })

  test('loadFromDisk with missing file causes no error, data unchanged', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const nonExistentPath = tempFilePath()

    // Should not throw
    await store.loadFromDisk(nonExistentPath)

    // Data should remain empty
    assert.lengthOf(store.queries.getQueries(), 0)
    assert.lengthOf(store.events.getEvents(), 0)
    assert.lengthOf(store.emails.getEmails(), 0)
  })

  test('saveToDisk with tracing disabled does not include traces key', async ({ assert }) => {
    const filePath = tempFilePath()
    filesToCleanUp.push(filePath)

    const store = new DebugStore(baseConfig({ tracing: false }))
    await store.saveToDisk(filePath)

    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw)

    assert.property(data, 'queries')
    assert.property(data, 'events')
    assert.property(data, 'emails')
    assert.notProperty(data, 'traces')
  })
})

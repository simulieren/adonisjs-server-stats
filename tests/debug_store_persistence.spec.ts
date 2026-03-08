import { test } from '@japa/runner'
import { readFile, unlink } from 'node:fs/promises'
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

async function cleanupFiles(files: string[]) {
  for (const f of files) {
    try { await unlink(f) } catch { /* ignore */ }
    try { await unlink(f + '.tmp') } catch { /* ignore */ }
  }
}

function emitSampleData(emitter: ReturnType<typeof createMockEmitter>) {
  emitter.emit('db:query', {
    sql: 'SELECT * FROM products',
    bindings: [],
    duration: 5.0,
    method: 'select',
    model: null,
    connection: 'default',
    inTransaction: false,
  })
  emitter.emit('test:save', { key: 'value' })
  emitter.emit('mail:sending', {
    message: { from: 'a@b.com', to: 'c@d.com', subject: 'Persist test' },
    mailerName: 'smtp',
  })
}

// ---------------------------------------------------------------------------
// onNewItem()
// ---------------------------------------------------------------------------

test.group('DebugStore | onNewItem() (queries & events)', () => {
  test('callback fires for queries, events, and emails with correct type strings', async ({
    assert,
  }) => {
    const store = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    const received: string[] = []
    store.onNewItem((type) => received.push(type))

    emitter.emit('db:query', {
      sql: 'SELECT 1',
      bindings: [],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
    })

    emitter.emit('user:registered', { id: 1 })

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
})

test.group('DebugStore | onNewItem() (unregister)', () => {
  test('onNewItem(null) unregisters all callbacks', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const emitter = createMockEmitter()
    await store.start(emitter, null)

    const received: string[] = []
    store.onNewItem((type) => received.push(type))

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

    store.onNewItem(null)

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
// Integration: emit -> collector
// ---------------------------------------------------------------------------

test.group('DebugStore | Integration (db:query)', () => {
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
})

test.group('DebugStore | Integration (events & emails)', () => {
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
// saveToDisk — round trip
// ---------------------------------------------------------------------------

test.group('DebugStore | saveToDisk (round trip)', (group) => {
  const filesToCleanUp: string[] = []
  group.teardown(() => cleanupFiles(filesToCleanUp))

  test('round-trip: save data, create fresh store, load, verify all data restored', async ({
    assert,
  }) => {
    const filePath = tempFilePath()
    filesToCleanUp.push(filePath)

    const store1 = new DebugStore(baseConfig({ tracing: true }))
    const emitter = createMockEmitter()
    await store1.start(emitter, null)
    emitSampleData(emitter)

    assert.isAbove(store1.queries.getQueries().length, 0)
    assert.isAbove(store1.events.getEvents().length, 0)
    assert.isAbove(store1.emails.getEmails().length, 0)

    store1.stop()
    await store1.saveToDisk(filePath)

    const store2 = new DebugStore(baseConfig({ tracing: true }))
    await store2.loadFromDisk(filePath)

    const queries = store2.queries.getQueries()
    assert.isAbove(queries.length, 0)
    assert.equal(queries[0].sql, 'SELECT * FROM products')

    const events = store2.events.getEvents()
    assert.isAbove(events.length, 0)

    const emails = store2.emails.getEmails()
    assert.isAbove(emails.length, 0)
    assert.equal(emails[0].subject, 'Persist test')

    store2.traces?.stop()
  })
})

// ---------------------------------------------------------------------------
// saveToDisk — edge cases
// ---------------------------------------------------------------------------

test.group('DebugStore | saveToDisk (edge cases)', (group) => {
  const filesToCleanUp: string[] = []
  group.teardown(() => cleanupFiles(filesToCleanUp))

  test('loadFromDisk with missing file causes no error, data unchanged', async ({ assert }) => {
    const store = new DebugStore(baseConfig())
    const nonExistentPath = tempFilePath()

    await store.loadFromDisk(nonExistentPath)

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

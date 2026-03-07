import { test } from '@japa/runner'
import { QueryCollector } from '../src/debug/query_collector.js'

class MockEmitter {
  private handlers = new Map<string, Function[]>()
  on(event: string, handler: Function) {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
  }
  off(event: string, handler: Function) {
    const list = this.handlers.get(event)
    if (list) {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
  emit(event: string, data: unknown) {
    for (const h of this.handlers.get(event) || []) h(data)
  }
}

function makeQueryEvent(overrides: Record<string, unknown> = {}) {
  return {
    sql: 'SELECT * FROM users',
    bindings: [],
    duration: 1.5,
    method: 'select',
    model: null,
    connection: 'default',
    inTransaction: false,
    ...overrides,
  }
}

test.group('QueryCollector | Core functionality', () => {
  test('records queries from db:query events', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1' }))

    const queries = collector.getQueries()
    assert.lengthOf(queries, 1)
    assert.equal(queries[0].sql, 'SELECT 1')
    assert.equal(queries[0].method, 'select')
    assert.equal(queries[0].connection, 'default')

    collector.stop()
  })

  test('skips server_stats connection', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    emitter.emit('db:query', makeQueryEvent({ connection: 'server_stats' }))

    assert.lengthOf(collector.getQueries(), 0)

    collector.stop()
  })

  test('handles numeric duration', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    emitter.emit('db:query', makeQueryEvent({ duration: 5.5 }))

    const queries = collector.getQueries()
    assert.equal(queries[0].duration, 5.5)

    collector.stop()
  })

  test('handles hrtime tuple duration', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    // [0 seconds, 5_500_000 nanoseconds] = 5.5 ms
    emitter.emit('db:query', makeQueryEvent({ duration: [0, 5_500_000] }))

    const queries = collector.getQueries()
    assert.equal(queries[0].duration, 5.5)

    collector.stop()
  })
})

test.group('QueryCollector | Performance-critical methods', () => {
  test('getQueriesSince(lastId) returns only new queries', async ({ assert }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 100; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    const since = collector.getQueriesSince(95)
    assert.lengthOf(since, 5)
    assert.equal(since[0].id, 96)
    assert.equal(since[4].id, 100)

    collector.stop()
  })

  test('getQueriesSince(0) returns all', async ({ assert }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 10; i++) {
      emitter.emit('db:query', makeQueryEvent())
    }

    const all = collector.getQueriesSince(0)
    assert.lengthOf(all, 10)

    collector.stop()
  })

  test('getQueriesSince with large buffer returns only tail items', async ({ assert }) => {
    const collector = new QueryCollector(10_000)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 10_000; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    const since = collector.getQueriesSince(9995)
    assert.lengthOf(since, 5)
    assert.equal(since[0].id, 9996)
    assert.equal(since[4].id, 10_000)

    collector.stop()
  })

  test('getSummary() returns correct counts', async ({ assert }) => {
    // slowThresholdMs = 50
    const collector = new QueryCollector(500, 50)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    // 3 fast queries with same SQL (duplicates)
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1', duration: 10 }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1', duration: 20 }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1', duration: 30 }))

    // 2 slow queries with unique SQL
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 2', duration: 100 }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 3', duration: 200 }))

    const summary = collector.getSummary()
    assert.equal(summary.total, 5)
    assert.equal(summary.slow, 2)
    // "SELECT 1" appears 3 times -> 1 duplicate entry
    assert.equal(summary.duplicates, 1)
    // avg = (10+20+30+100+200)/5 = 72
    assert.equal(summary.avgDuration, 72)

    collector.stop()
  })

  test('getSummary() caches for 1 second', async ({ assert }) => {
    const collector = new QueryCollector(500, 50)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1', duration: 10 }))

    const summary1 = collector.getSummary()
    assert.equal(summary1.total, 1)

    // Push more queries — summary should still be cached
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 2', duration: 20 }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 3', duration: 30 }))

    const summary2 = collector.getSummary()
    assert.strictEqual(summary2, summary1)
    assert.equal(summary2.total, 1) // still cached

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const summary3 = collector.getSummary()
    assert.notStrictEqual(summary3, summary1)
    assert.equal(summary3.total, 3) // now updated

    collector.stop()
  })

  test('getLatest(n) returns n most recent in reverse order', async ({ assert }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 50; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    const latest = collector.getLatest(5)
    assert.lengthOf(latest, 5)
    // newest first
    assert.equal(latest[0].sql, 'SELECT 49')
    assert.equal(latest[1].sql, 'SELECT 48')
    assert.equal(latest[2].sql, 'SELECT 47')
    assert.equal(latest[3].sql, 'SELECT 46')
    assert.equal(latest[4].sql, 'SELECT 45')

    collector.stop()
  })
})

test.group('QueryCollector | Buffer behavior', () => {
  test('ring buffer wraps at capacity', async ({ assert }) => {
    const collector = new QueryCollector(10)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 15; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    const queries = collector.getQueries()
    assert.lengthOf(queries, 10)
    // oldest 5 (0-4) should be gone, first remaining is SELECT 5
    assert.equal(queries[0].sql, 'SELECT 5')
    assert.equal(queries[9].sql, 'SELECT 14')

    collector.stop()
  })

  test('clear() resets everything', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    emitter.emit('db:query', makeQueryEvent())
    emitter.emit('db:query', makeQueryEvent())

    assert.equal(collector.getTotalCount(), 2)

    collector.clear()

    assert.lengthOf(collector.getQueries(), 0)
    assert.equal(collector.getTotalCount(), 0)

    collector.stop()
  })

  test('getBufferInfo returns correct current/max', async ({ assert }) => {
    const collector = new QueryCollector(200)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 25; i++) {
      emitter.emit('db:query', makeQueryEvent())
    }

    const info = collector.getBufferInfo()
    assert.equal(info.current, 25)
    assert.equal(info.max, 200)

    collector.stop()
  })

  test('onNewItem fires callback', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    const received: unknown[] = []
    collector.onNewItem((item) => received.push(item))

    emitter.emit('db:query', makeQueryEvent({ sql: 'INSERT INTO logs' }))

    assert.lengthOf(received, 1)
    assert.equal((received[0] as any).sql, 'INSERT INTO logs')

    // Clean up callback
    collector.onNewItem(null)
    collector.stop()
  })
})

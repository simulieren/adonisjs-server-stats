import { test } from '@japa/runner'
import { QueryCollector } from '../src/debug/query_collector.js'
import { TraceCollector } from '../src/debug/trace_collector.js'

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
    for (const h of this.handlers.get(event) || []) (h as Function)(data)
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

test.group('Stress | QueryCollector under load', () => {
  test('10,000 queries — getQueriesSince returns only tail', async ({ assert }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 10_000; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    // Buffer capacity is 500, so getQueriesSince(0) returns all 500
    const all = collector.getQueriesSince(0)
    assert.lengthOf(all, 500)

    // Note the ID of the item at index 490 (10 from the end)
    const pivotId = all[490 - 1].id

    // getQueriesSince(pivotId) should return exactly 10 items
    const tail = collector.getQueriesSince(pivotId)
    assert.lengthOf(tail, 10)

    // Verify the 10 items have sequential IDs
    for (let i = 1; i < tail.length; i++) {
      assert.equal(tail[i].id, tail[i - 1].id + 1)
    }

    collector.stop()
  })

  test('rapid getSummary() under continuous writes — cache prevents recomputation', async ({
    assert,
  }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 500; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    // Call getSummary() 100 times in a tight loop
    const summaries = []
    for (let i = 0; i < 100; i++) {
      summaries.push(collector.getSummary())
    }

    // All 100 should return the same object reference (cached)
    for (let i = 1; i < summaries.length; i++) {
      assert.strictEqual(summaries[i], summaries[0])
    }

    // Verify total === 500
    assert.equal(summaries[0].total, 500)

    collector.stop()
  })

  test('getQueriesSince performance — 50,000 queries, get last 10', async ({ assert }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 50_000; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    // Record the lastId before emitting 10 more
    const before = collector.getQueries()
    const lastId = before[before.length - 1].id

    // Emit 10 more queries
    for (let i = 0; i < 10; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `NEW ${i}` }))
    }

    // Measure time for getQueriesSince(lastId)
    const start = performance.now()
    const since = collector.getQueriesSince(lastId)
    const elapsed = performance.now() - start

    // Assert it returns exactly 10 items
    assert.lengthOf(since, 10)

    // Assert it completes in < 5ms (it's O(K) where K=10)
    assert.isBelow(elapsed, 5, `getQueriesSince took ${elapsed}ms, expected < 5ms`)

    collector.stop()
  })

  test('concurrent getQueries + getSummary + getQueriesSince — no corruption', async ({
    assert,
  }) => {
    const collector = new QueryCollector(500)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 500; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    // Repeat 50 times
    for (let round = 0; round < 50; round++) {
      const [queries, summary, since] = await Promise.all([
        Promise.resolve(collector.getQueries()),
        Promise.resolve(collector.getSummary()),
        Promise.resolve(collector.getQueriesSince(495)),
      ])

      assert.lengthOf(queries, 500)
      assert.equal(summary.total, 500)
      assert.lengthOf(since, 5)
    }

    collector.stop()
  })

  test('buffer wrap consistency — IDs remain monotonic after wrap', async ({ assert }) => {
    const collector = new QueryCollector(100)
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 500; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    const queries = collector.getQueries()
    assert.lengthOf(queries, 100)

    // IDs should be monotonically increasing across the returned array
    for (let i = 1; i < queries.length; i++) {
      assert.isAbove(queries[i].id, queries[i - 1].id)
    }

    // First ID should be > 400 (items 1-400 were overwritten)
    assert.isAbove(queries[0].id, 400)

    collector.stop()
  })

  test('loadRecords + continued recording — no ID collision', async ({ assert }) => {
    const collector = new QueryCollector(100)

    // loadRecords with 50 records having IDs 1-50
    const records = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      sql: `LOADED ${i}`,
      bindings: [] as unknown[],
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
      inTransaction: false,
      timestamp: Date.now(),
    }))
    collector.loadRecords(records)

    // Emit 30 more queries
    const emitter = new MockEmitter()
    await collector.start(emitter as any)

    for (let i = 0; i < 30; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `NEW ${i}` }))
    }

    const queries = collector.getQueries()
    assert.lengthOf(queries, 80)

    // IDs of new items should start at 51
    const newItems = queries.filter((q) => q.sql.startsWith('NEW'))
    assert.lengthOf(newItems, 30)
    assert.equal(newItems[0].id, 51)

    collector.stop()
  })
})

test.group('Stress | TraceCollector under load', (group) => {
  let collector: TraceCollector

  group.each.teardown(() => {
    collector?.stop()
  })

  test('MAX_SPANS_PER_TRACE cap — 200 span limit holds', async ({ assert }) => {
    collector = new TraceCollector()

    await collector.startTrace(async () => {
      // Add 300 spans
      for (let i = 0; i < 300; i++) {
        collector.addSpan(`span-${i}`, 'custom', 0, 1)
      }

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.equal(record!.spans.length, 200)
      assert.equal(record!.spanCount, 200)
    })
  })

  test('1000 traces — buffer wraps correctly', async ({ assert }) => {
    collector = new TraceCollector(200)

    for (let i = 0; i < 1000; i++) {
      await collector.startTrace(async () => {
        collector.addSpan(`span-${i}`, 'custom', 0, 1)
        collector.finishTrace('GET', `/test/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    assert.lengthOf(traces, 200)

    // IDs should be monotonic
    for (let i = 1; i < traces.length; i++) {
      assert.isAbove(traces[i].id, traces[i - 1].id)
    }
  })

  test('getTrace(id) via findFromEnd — finds correct trace in 10,000', async ({ assert }) => {
    collector = new TraceCollector(10_000)

    for (let i = 0; i < 10_000; i++) {
      await collector.startTrace(async () => {
        collector.addSpan(`span-${i}`, 'custom', 0, 1)
        collector.finishTrace('GET', `/test/${i}`, 200)
      })
    }

    // getTrace(5000) should return the trace with id 5000
    const trace5000 = collector.getTrace(5000)
    assert.isDefined(trace5000)
    assert.equal(trace5000!.id, 5000)
    assert.equal(trace5000!.url, '/test/4999')

    // getTrace(1) should still exist since capacity is 10,000
    const trace1 = collector.getTrace(1)
    assert.isDefined(trace1)
    assert.equal(trace1!.id, 1)
  })

  test('concurrent trace operations — no data corruption', async ({ assert }) => {
    collector = new TraceCollector(200)

    // Start 50 traces sequentially (simulating concurrent requests)
    for (let i = 0; i < 50; i++) {
      await collector.startTrace(async () => {
        collector.addSpan(`span-${i}`, 'custom', 0, 1)
        collector.finishTrace('GET', `/request/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    assert.lengthOf(traces, 50)

    // Verify all 50 are recorded with correct data
    for (let i = 0; i < 50; i++) {
      assert.equal(traces[i].url, `/request/${i}`)
      assert.equal(traces[i].method, 'GET')
      assert.equal(traces[i].statusCode, 200)
      assert.equal(traces[i].spanCount, 1)
      assert.lengthOf(traces[i].spans, 1)
    }
  })
})

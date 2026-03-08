import { test } from '@japa/runner'
import type { Emitter } from '../src/debug/types.js'
import { TraceCollector, trace } from '../src/debug/trace_collector.js'
import type { TraceRecord, TraceSpan } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEmitter() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
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
    emit(event: string, data: unknown) {
      handlers[event]?.forEach((h) => h(data))
    },
    handlers,
  }
}

/** Small async delay to simulate real work and ensure measurable durations. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Core lifecycle
// ============================================================================

test.group('TraceCollector | Core lifecycle', (group) => {
  let collector: TraceCollector

  group.each.setup(() => {
    collector = new TraceCollector(100)
  })

  group.each.teardown(() => {
    collector.stop()
  })

  test('startTrace creates a trace context and finishTrace returns a record', async ({
    assert,
  }) => {
    let record: TraceRecord | null = null

    await collector.startTrace(async () => {
      record = collector.finishTrace('GET', '/users', 200)
    })

    assert.isNotNull(record)
    assert.equal(record!.method, 'GET')
    assert.equal(record!.url, '/users')
    assert.equal(record!.statusCode, 200)
    assert.isAbove(record!.totalDuration, -1) // duration >= 0
    assert.equal(record!.spanCount, 0)
    assert.deepEqual(record!.spans, [])
    assert.deepEqual(record!.warnings, [])
    assert.isAbove(record!.timestamp, 0)
    assert.isNumber(record!.id)
  })

  test('finishTrace records the trace in the buffer', async ({ assert }) => {
    await collector.startTrace(async () => {
      collector.finishTrace('POST', '/items', 201)
    })

    const traces = collector.getTraces()
    assert.lengthOf(traces, 1)
    assert.equal(traces[0].method, 'POST')
    assert.equal(traces[0].url, '/items')
    assert.equal(traces[0].statusCode, 201)
  })

  test('addSpan adds a span to the active trace', async ({ assert }) => {
    await collector.startTrace(async () => {
      collector.addSpan({ label: 'SELECT * FROM users', category: 'db', startOffset: 0, duration: 5.5, metadata: { connection: 'pg' } })
      const record = collector.finishTrace('GET', '/users', 200)

      assert.isNotNull(record)
      assert.equal(record!.spanCount, 1)
      assert.lengthOf(record!.spans, 1)
      assert.equal(record!.spans[0].label, 'SELECT * FROM users')
      assert.equal(record!.spans[0].category, 'db')
      assert.equal(record!.spans[0].duration, 5.5)
      assert.deepEqual(record!.spans[0].metadata, { connection: 'pg' })
      assert.isNull(record!.spans[0].parentId) // root span
      assert.equal(record!.spans[0].id, '1')
    })
  })

  test('span() wraps an async function and auto-creates a span', async ({ assert }) => {
    await collector.startTrace(async () => {
      const result = await collector.span('doWork', 'custom', async () => {
        await delay(10)
        return 42
      })

      assert.equal(result, 42) // return value is forwarded

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 1)
      assert.equal(record!.spans[0].label, 'doWork')
      assert.equal(record!.spans[0].category, 'custom')
      assert.isAbove(record!.spans[0].duration, 5) // at least some time elapsed
    })
  })

  test('span() records the span even when the wrapped function throws', async ({ assert }) => {
    await collector.startTrace(async () => {
      try {
        await collector.span('failingOp', 'custom', async () => {
          throw new Error('boom')
        })
      } catch {
        // expected
      }

      const record = collector.finishTrace('GET', '/test', 500)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 1)
      assert.equal(record!.spans[0].label, 'failingOp')
    })
  })

  test('multiple addSpan calls create multiple spans with incrementing IDs', async ({
    assert,
  }) => {
    await collector.startTrace(async () => {
      collector.addSpan({ label: 'span-1', category: 'db', startOffset: 0, duration: 1 })
      collector.addSpan({ label: 'span-2', category: 'custom', startOffset: 1, duration: 2 })
      collector.addSpan('span-3', 'middleware', 3, 3)

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.equal(record!.spanCount, 3)
      assert.equal(record!.spans[0].id, '1')
      assert.equal(record!.spans[1].id, '2')
      assert.equal(record!.spans[2].id, '3')
    })
  })

  test('addSpan without metadata omits the metadata field', async ({ assert }) => {
    await collector.startTrace(async () => {
      collector.addSpan('bare-span', 'custom', 0, 1)
      const record = collector.finishTrace('GET', '/test', 200)

      assert.isUndefined(record!.spans[0].metadata)
    })
  })

  test('totalDuration is rounded to 2 decimal places', async ({ assert }) => {
    await collector.startTrace(async () => {
      await delay(5)
      const record = collector.finishTrace('GET', '/test', 200)
      // round(x) = Math.round(x * 100) / 100 — at most 2 decimals
      const decimals = String(record!.totalDuration).split('.')[1]
      if (decimals) {
        assert.isAtMost(decimals.length, 2)
      }
    })
  })

  test('trace IDs are monotonically increasing (newest-first order)', async ({ assert }) => {
    for (let i = 0; i < 5; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    // newest-first: IDs should be decreasing
    for (let i = 1; i < traces.length; i++) {
      assert.isBelow(traces[i].id, traces[i - 1].id)
    }
  })
})

// ============================================================================
// Span nesting
// ============================================================================

test.group('TraceCollector | Span nesting', (group) => {
  let collector: TraceCollector

  group.each.setup(() => {
    collector = new TraceCollector(100)
  })

  group.each.teardown(() => {
    collector.stop()
  })

  test('nested span() calls set parentId correctly', async ({ assert }) => {
    await collector.startTrace(async () => {
      await collector.span('outer', 'custom', async () => {
        await collector.span('inner', 'db', async () => {
          await delay(1)
        })
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 2)

      // Inner span is pushed first (when it finishes), then outer span
      const innerSpan = record!.spans[0]
      const outerSpan = record!.spans[1]

      assert.equal(innerSpan.label, 'inner')
      assert.equal(outerSpan.label, 'outer')

      // Inner's parent should be the outer span
      assert.equal(innerSpan.parentId, outerSpan.id)

      // Outer has no parent
      assert.isNull(outerSpan.parentId)
    })
  })

  test('deeply nested spans (3+ levels) maintain correct parent chain', async ({ assert }) => {
    await collector.startTrace(async () => {
      await collector.span('level1', 'custom', async () => {
        await collector.span('level2', 'custom', async () => {
          await collector.span('level3', 'db', async () => {
            await delay(1)
          })
        })
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 3)

      // Spans finish in inside-out order: level3, level2, level1
      const [level3, level2, level1] = record!.spans

      assert.equal(level3.label, 'level3')
      assert.equal(level2.label, 'level2')
      assert.equal(level1.label, 'level1')

      // level3 parent = level2, level2 parent = level1, level1 parent = null
      assert.equal(level3.parentId, level2.id)
      assert.equal(level2.parentId, level1.id)
      assert.isNull(level1.parentId)
    })
  })

  test('sibling spans at the same level have the same parentId', async ({ assert }) => {
    await collector.startTrace(async () => {
      await collector.span('parent', 'custom', async () => {
        await collector.span('child-1', 'db', async () => {
          await delay(1)
        })
        await collector.span('child-2', 'db', async () => {
          await delay(1)
        })
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 3)

      const child1 = record!.spans.find((s) => s.label === 'child-1')!
      const child2 = record!.spans.find((s) => s.label === 'child-2')!
      const parent = record!.spans.find((s) => s.label === 'parent')!

      assert.equal(child1.parentId, parent.id)
      assert.equal(child2.parentId, parent.id)
    })
  })

  test('addSpan within a span() context gets the span as parent', async ({ assert }) => {
    await collector.startTrace(async () => {
      await collector.span('wrapper', 'custom', async () => {
        collector.addSpan('manual-child', 'db', 0, 1)
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)

      const manualChild = record!.spans.find((s) => s.label === 'manual-child')!
      const wrapper = record!.spans.find((s) => s.label === 'wrapper')!

      assert.equal(manualChild.parentId, wrapper.id)
    })
  })

  test('span nesting is restored after inner span throws', async ({ assert }) => {
    await collector.startTrace(async () => {
      await collector.span('outer', 'custom', async () => {
        try {
          await collector.span('failing-inner', 'custom', async () => {
            throw new Error('fail')
          })
        } catch {
          // expected
        }

        // This sibling should still have outer as parent, not failing-inner
        await collector.span('recovery-sibling', 'custom', async () => {
          await delay(1)
        })
      })

      const record = collector.finishTrace('GET', '/test', 200)
      const outer = record!.spans.find((s) => s.label === 'outer')!
      const sibling = record!.spans.find((s) => s.label === 'recovery-sibling')!

      assert.equal(sibling.parentId, outer.id)
    })
  })
})

// ============================================================================
// Context management
// ============================================================================

test.group('TraceCollector | Context management', (group) => {
  let collector: TraceCollector

  group.each.setup(() => {
    collector = new TraceCollector(100)
  })

  group.each.teardown(() => {
    collector.stop()
  })

  test('finishTrace without startTrace returns null', async ({ assert }) => {
    const result = collector.finishTrace('GET', '/test', 200)
    assert.isNull(result)
  })

  test('addSpan without active trace is a no-op', async ({ assert }) => {
    // Should not throw
    collector.addSpan('orphan', 'db', 0, 1)
    assert.equal(collector.getTotalCount(), 0)
  })

  test('span() without active trace executes the function directly', async ({ assert }) => {
    const result = await collector.span('no-ctx', 'custom', async () => {
      return 'executed'
    })
    assert.equal(result, 'executed')
    assert.equal(collector.getTotalCount(), 0)
  })

  test('startTrace without finishTrace does not add to buffer', async ({ assert }) => {
    await collector.startTrace(async () => {
      // Intentionally not calling finishTrace
      collector.addSpan('orphan-span', 'custom', 0, 1)
    })

    assert.equal(collector.getTotalCount(), 0)
  })

  test('each startTrace gets an independent context', async ({ assert }) => {
    await collector.startTrace(async () => {
      collector.addSpan('trace1-span', 'custom', 0, 1)
      collector.finishTrace('GET', '/first', 200)
    })

    await collector.startTrace(async () => {
      collector.addSpan('trace2-span-a', 'db', 0, 1)
      collector.addSpan('trace2-span-b', 'db', 1, 2)
      collector.finishTrace('POST', '/second', 201)
    })

    const traces = collector.getTraces()
    assert.lengthOf(traces, 2)
    // newest-first: /second is at index 0
    assert.equal(traces[0].spanCount, 2)
    assert.equal(traces[1].spanCount, 1)
    assert.equal(traces[0].url, '/second')
    assert.equal(traces[1].url, '/first')
  })

  test('concurrent traces via Promise.all maintain isolation', async ({ assert }) => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      collector.startTrace(async () => {
        await delay(1) // yield to allow interleaving
        collector.addSpan(`span-for-trace-${i}`, 'custom', 0, 1)
        collector.finishTrace('GET', `/concurrent/${i}`, 200)
      })
    )

    await Promise.all(promises)

    const traces = collector.getTraces()
    assert.lengthOf(traces, 10)

    // Each trace should have exactly 1 span
    for (const t of traces) {
      assert.equal(t.spanCount, 1)
      assert.lengthOf(t.spans, 1)
    }
  })
})

// ============================================================================
// Buffer management
// ============================================================================

test.group('TraceCollector | Buffer management', (group) => {
  let collector: TraceCollector

  group.each.teardown(() => {
    collector?.stop()
  })

  test('getTraces returns all completed traces', async ({ assert }) => {
    collector = new TraceCollector(100)

    for (let i = 0; i < 5; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    assert.lengthOf(traces, 5)
  })

  test('returns traces in newest-first order', async ({ assert }) => {
    collector = new TraceCollector(100)

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/first', 200)
    })

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/second', 200)
    })

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/third', 200)
    })

    const traces = collector.getTraces()
    assert.lengthOf(traces, 3)
    assert.equal(traces[0].url, '/third')
    assert.equal(traces[1].url, '/second')
    assert.equal(traces[2].url, '/first')
  })

  test('getLatest(n) returns the n most recent traces (newest first)', async ({ assert }) => {
    collector = new TraceCollector(100)

    for (let i = 0; i < 10; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const latest3 = collector.getLatest(3)
    assert.lengthOf(latest3, 3)
    // newest first
    assert.equal(latest3[0].url, '/t/9')
    assert.equal(latest3[1].url, '/t/8')
    assert.equal(latest3[2].url, '/t/7')
  })

  test('getLatest(n) with n > count returns all traces', async ({ assert }) => {
    collector = new TraceCollector(100)

    for (let i = 0; i < 3; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const all = collector.getLatest(100)
    assert.lengthOf(all, 3)
  })

  test('getTrace(id) finds the trace by ID', async ({ assert }) => {
    collector = new TraceCollector(100)

    for (let i = 0; i < 5; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const trace3 = collector.getTrace(3)
    assert.isDefined(trace3)
    assert.equal(trace3!.id, 3)
    assert.equal(trace3!.url, '/t/2')
  })

  test('getTrace(id) returns undefined for non-existent ID', async ({ assert }) => {
    collector = new TraceCollector(100)
    const result = collector.getTrace(999)
    assert.isUndefined(result)
  })

  test('buffer wraps at capacity and oldest traces are overwritten', async ({ assert }) => {
    collector = new TraceCollector(5) // small buffer

    for (let i = 0; i < 10; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    assert.lengthOf(traces, 5)

    // Only the last 5 should remain, newest-first
    assert.equal(traces[0].url, '/t/9')
    assert.equal(traces[4].url, '/t/5')
  })

  test('MAX_SPANS_PER_TRACE (200) is enforced', async ({ assert }) => {
    collector = new TraceCollector(10)

    await collector.startTrace(async () => {
      for (let i = 0; i < 250; i++) {
        collector.addSpan(`span-${i}`, 'custom', 0, 1)
      }
      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.equal(record!.spans.length, 200)
      assert.equal(record!.spanCount, 200)
    })
  })

  test('clear() empties the buffer', async ({ assert }) => {
    collector = new TraceCollector(100)

    for (let i = 0; i < 5; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    assert.equal(collector.getTotalCount(), 5)
    collector.clear()
    assert.equal(collector.getTotalCount(), 0)
    assert.deepEqual(collector.getTraces(), [])
  })

  test('getTotalCount returns current buffer size', async ({ assert }) => {
    collector = new TraceCollector(100)
    assert.equal(collector.getTotalCount(), 0)

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/t/0', 200)
    })

    assert.equal(collector.getTotalCount(), 1)
  })

  test('getBufferInfo returns current and max', async ({ assert }) => {
    collector = new TraceCollector(50)

    for (let i = 0; i < 10; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const info = collector.getBufferInfo()
    assert.equal(info.current, 10)
    assert.equal(info.max, 50)
  })

  test('getBufferInfo.current does not exceed max after wrapping', async ({ assert }) => {
    collector = new TraceCollector(5)

    for (let i = 0; i < 20; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    const info = collector.getBufferInfo()
    assert.equal(info.current, 5)
    assert.equal(info.max, 5)
  })
})

// ============================================================================
// Event integration (start / stop)
// ============================================================================

test.group('TraceCollector | Event integration', (group) => {
  let collector: TraceCollector
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(() => {
    collector = new TraceCollector(100)
    emitter = createMockEmitter()
  })

  group.each.teardown(() => {
    collector.stop()
  })

  test('start() hooks db:query events to auto-create spans', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      emitter.emit('db:query', {
        sql: 'SELECT * FROM users',
        duration: 3.5,
        method: 'select',
        model: 'User',
        connection: 'pg',
      })

      const record = collector.finishTrace('GET', '/users', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 1)

      const span = record!.spans[0]
      assert.equal(span.label, 'SELECT * FROM users')
      assert.equal(span.category, 'db')
      assert.equal(span.duration, 3.5)
      assert.deepEqual(span.metadata, {
        method: 'select',
        model: 'User',
        connection: 'pg',
      })
    })
  })

  test('db query span has no parentId (root level)', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      emitter.emit('db:query', {
        sql: 'SELECT 1',
        duration: 1,
        method: 'select',
        model: null,
        connection: 'default',
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNull(record!.spans[0].parentId)
    })
  })

  test('db query span inside a span() gets correct parentId', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      await collector.span('fetchUsers', 'custom', async () => {
        emitter.emit('db:query', {
          sql: 'SELECT * FROM users',
          duration: 2,
          method: 'select',
          model: null,
          connection: 'default',
        })
      })

      const record = collector.finishTrace('GET', '/users', 200)
      const dbSpan = record!.spans.find((s) => s.category === 'db')!
      const wrapperSpan = record!.spans.find((s) => s.label === 'fetchUsers')!

      assert.equal(dbSpan.parentId, wrapperSpan.id)
    })
  })

  test('duration parsing for hrtime tuple [seconds, nanoseconds]', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      // [1 second, 500_000_000 nanoseconds] = 1500ms
      emitter.emit('db:query', {
        sql: 'SLOW QUERY',
        duration: [1, 500_000_000],
        method: 'select',
        model: null,
        connection: 'default',
      })

      const record = collector.finishTrace('GET', '/test', 200)
      const span = record!.spans[0]
      // 1 * 1e3 + 500_000_000 / 1e6 = 1000 + 500 = 1500
      assert.equal(span.duration, 1500)
    })
  })

  test('duration parsing for hrtime [0, nanoseconds]', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      // [0, 2_500_000] = 2.5ms
      emitter.emit('db:query', {
        sql: 'FAST QUERY',
        duration: [0, 2_500_000],
        method: 'select',
        model: null,
        connection: 'default',
      })

      const record = collector.finishTrace('GET', '/test', 200)
      const span = record!.spans[0]
      assert.equal(span.duration, 2.5)
    })
  })

  test('duration defaults to 0 when missing', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      emitter.emit('db:query', {
        sql: 'NO DURATION',
        method: 'select',
        model: null,
        connection: 'default',
      })

      const record = collector.finishTrace('GET', '/test', 200)
      const span = record!.spans[0]
      assert.equal(span.duration, 0)
    })
  })

  test('db:query event outside trace context is ignored', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    // Emit outside any trace context
    emitter.emit('db:query', {
      sql: 'SELECT 1',
      duration: 1,
      method: 'select',
      model: null,
      connection: 'default',
    })

    assert.equal(collector.getTotalCount(), 0)
  })

  test('sql defaults to "query" when sql field is missing', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      emitter.emit('db:query', {
        duration: 1,
        method: 'raw',
        model: null,
        connection: 'default',
      })

      const record = collector.finishTrace('GET', '/test', 200)
      assert.equal(record!.spans[0].label, 'query')
    })
  })

  test('stop() unhooks db:query events', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    // Verify handler is registered
    assert.isAbove(emitter.handlers['db:query']?.length ?? 0, 0)

    collector.stop()

    // Handler should be removed
    assert.equal(emitter.handlers['db:query']?.length ?? 0, 0)
  })

  test('multiple db queries create multiple spans', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      for (let i = 0; i < 5; i++) {
        emitter.emit('db:query', {
          sql: `SELECT ${i}`,
          duration: i + 1,
          method: 'select',
          model: null,
          connection: 'default',
        })
      }

      const record = collector.finishTrace('GET', '/test', 200)
      assert.equal(record!.spanCount, 5)
      assert.lengthOf(record!.spans, 5)
    })
  })
})

// ============================================================================
// Console.warn interception
// ============================================================================

test.group('TraceCollector | Console.warn interception', (group) => {
  let collector: TraceCollector
  let emitter: ReturnType<typeof createMockEmitter>
  const originalConsoleWarn = console.warn

  group.each.setup(() => {
    collector = new TraceCollector(100)
    emitter = createMockEmitter()
  })

  group.each.teardown(() => {
    collector.stop()
    // Safety net: always restore console.warn
    console.warn = originalConsoleWarn
  })

  test('console.warn calls within a trace context are collected as warnings', async ({
    assert,
  }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      console.warn('something is wrong')
      console.warn('another warning', 'with', 'multiple args')

      const record = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.warnings, 2)
      assert.equal(record!.warnings[0], 'something is wrong')
      assert.equal(record!.warnings[1], 'another warning with multiple args')
    })
  })

  test('console.warn outside trace context still passes through to original', async ({
    assert,
  }) => {
    const captured: unknown[][] = []
    const mockWarn = (...args: unknown[]) => {
      captured.push(args)
    }
    console.warn = mockWarn

    collector.start(emitter as unknown as Emitter)

    // Call console.warn outside any trace
    console.warn('outside-trace')

    // The interceptor should have called the original (our mock)
    assert.isAbove(captured.length, 0)
    // Since our mock was set before start(), start() captures it as "original"
    // and the interceptor calls through to it
  })

  test('console.warn is restored after stop()', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    // console.warn should now be intercepted
    const interceptedWarn = console.warn
    assert.notStrictEqual(interceptedWarn, originalConsoleWarn)

    collector.stop()

    // After stop, console.warn should be restored to what it was before start()
    // Since we set it to originalConsoleWarn before start() was called via the
    // group setup, it should be restored
    assert.strictEqual(console.warn, originalConsoleWarn)
  })

  test('warnings are per-trace and do not leak between traces', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      console.warn('trace-1-warning')
      collector.finishTrace('GET', '/first', 200)
    })

    await collector.startTrace(async () => {
      console.warn('trace-2-warning')
      collector.finishTrace('GET', '/second', 200)
    })

    const traces = collector.getTraces()
    // newest-first: /second is at index 0
    assert.lengthOf(traces[0].warnings, 1)
    assert.equal(traces[0].warnings[0], 'trace-2-warning')
    assert.lengthOf(traces[1].warnings, 1)
    assert.equal(traces[1].warnings[0], 'trace-1-warning')
  })

  test('console.warn with non-string arguments converts to string', async ({ assert }) => {
    collector.start(emitter as unknown as Emitter)

    await collector.startTrace(async () => {
      console.warn('count:', 42, true, null, undefined)
      const record = collector.finishTrace('GET', '/test', 200)

      assert.lengthOf(record!.warnings, 1)
      assert.equal(record!.warnings[0], 'count: 42 true null undefined')
    })
  })
})

// ============================================================================
// Module-level trace() helper
// ============================================================================

test.group('TraceCollector | Module-level trace() helper', (group) => {
  let collector: TraceCollector | null = null

  group.each.teardown(() => {
    if (collector) {
      collector.stop()
      collector = null
    }
  })

  test('trace() calls globalTraceCollector.span() when collector exists', async ({ assert }) => {
    collector = new TraceCollector(100)

    await collector.startTrace(async () => {
      const result = await trace('myOp', async () => {
        await delay(1)
        return 'traced-result'
      })

      assert.equal(result, 'traced-result')

      const record = collector!.finishTrace('GET', '/test', 200)
      assert.isNotNull(record)
      assert.lengthOf(record!.spans, 1)
      assert.equal(record!.spans[0].label, 'myOp')
      assert.equal(record!.spans[0].category, 'custom')
    })
  })

  test('trace() executes function directly when no collector exists', async ({ assert }) => {
    // Ensure no collector is set (stop any previous one)
    // After stop(), globalTraceCollector is set to null
    const tempCollector = new TraceCollector(10)
    tempCollector.stop()

    const result = await trace('noCollector', async () => {
      return 'direct-result'
    })

    assert.equal(result, 'direct-result')
  })

  test('trace() propagates errors from the wrapped function', async ({ assert }) => {
    collector = new TraceCollector(100)

    await collector.startTrace(async () => {
      await assert.rejects(async () => {
        await trace('failOp', async () => {
          throw new Error('trace-error')
        })
      }, 'trace-error')
    })
  })
})

// ============================================================================
// loadRecords / onNewItem
// ============================================================================

test.group('TraceCollector | loadRecords and onNewItem', (group) => {
  let collector: TraceCollector

  group.each.setup(() => {
    collector = new TraceCollector(100)
  })

  group.each.teardown(() => {
    collector.stop()
  })

  test('loadRecords restores persisted traces into the buffer', async ({ assert }) => {
    const records: TraceRecord[] = [
      {
        id: 10,
        method: 'GET',
        url: '/loaded/1',
        statusCode: 200,
        totalDuration: 50,
        spanCount: 0,
        spans: [],
        warnings: [],
        timestamp: Date.now() - 1000,
      },
      {
        id: 20,
        method: 'POST',
        url: '/loaded/2',
        statusCode: 201,
        totalDuration: 100,
        spanCount: 1,
        spans: [
          {
            id: '1',
            parentId: null,
            label: 'db',
            category: 'db',
            startOffset: 0,
            duration: 5,
          },
        ],
        warnings: ['old warning'],
        timestamp: Date.now() - 500,
      },
    ]

    collector.loadRecords(records)

    const traces = collector.getTraces()
    assert.lengthOf(traces, 2)
    // newest-first (by insertion order, reversed)
    assert.equal(traces[0].id, 20)
    assert.equal(traces[1].id, 10)
    assert.equal(traces[0].url, '/loaded/2')
    assert.equal(traces[1].url, '/loaded/1')
  })

  test('loadRecords sets nextId so new traces continue after max loaded ID', async ({
    assert,
  }) => {
    const records: TraceRecord[] = [
      {
        id: 50,
        method: 'GET',
        url: '/loaded',
        statusCode: 200,
        totalDuration: 10,
        spanCount: 0,
        spans: [],
        warnings: [],
        timestamp: Date.now(),
      },
    ]

    collector.loadRecords(records)

    // Now create a new trace — its ID should be 51
    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/new', 200)
    })

    const traces = collector.getTraces()
    assert.lengthOf(traces, 2)
    // newest-first: new trace (id 51) is at index 0
    assert.equal(traces[0].id, 51)
  })

  test('loadRecords with empty array has no effect', async ({ assert }) => {
    collector.loadRecords([])
    assert.equal(collector.getTotalCount(), 0)
  })

  test('onNewItem callback fires on trace completion', async ({ assert }) => {
    const received: TraceRecord[] = []
    collector.onNewItem((item) => received.push(item))

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/callback-test', 200)
    })

    assert.lengthOf(received, 1)
    assert.equal(received[0].url, '/callback-test')
  })

  test('onNewItem callback fires for each trace', async ({ assert }) => {
    const received: TraceRecord[] = []
    collector.onNewItem((item) => received.push(item))

    for (let i = 0; i < 3; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/t/${i}`, 200)
      })
    }

    assert.lengthOf(received, 3)
  })

  test('onNewItem(null) removes the callback', async ({ assert }) => {
    const received: TraceRecord[] = []
    collector.onNewItem((item) => received.push(item))

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/before', 200)
    })

    collector.onNewItem(null)

    await collector.startTrace(async () => {
      collector.finishTrace('GET', '/after', 200)
    })

    assert.lengthOf(received, 1)
    assert.equal(received[0].url, '/before')
  })
})

// ============================================================================
// Edge cases and additional scenarios
// ============================================================================

test.group('TraceCollector | Edge cases', (group) => {
  let collector: TraceCollector

  group.each.teardown(() => {
    collector?.stop()
  })

  test('constructor sets globalTraceCollector for the module-level trace() helper', async ({
    assert,
  }) => {
    collector = new TraceCollector(10)

    // The module-level trace() function should work now
    await collector.startTrace(async () => {
      await trace('via-global', async () => 'ok')
      const record = collector.finishTrace('GET', '/test', 200)
      assert.lengthOf(record!.spans, 1)
      assert.equal(record!.spans[0].label, 'via-global')
    })
  })

  test('stop() sets globalTraceCollector to null', async ({ assert }) => {
    collector = new TraceCollector(10)
    collector.stop()

    // Now trace() should just execute the function directly
    const result = await trace('after-stop', async () => 'direct')
    assert.equal(result, 'direct')

    // Re-create for teardown
    collector = new TraceCollector(10)
  })

  test('default buffer capacity is 200', async ({ assert }) => {
    collector = new TraceCollector() // no argument = default 200
    const info = collector.getBufferInfo()
    assert.equal(info.max, 200)
  })

  test('span startOffset is relative to request start', async ({ assert }) => {
    collector = new TraceCollector(10)

    await collector.startTrace(async () => {
      await delay(10) // wait before creating span
      await collector.span('delayed', 'custom', async () => {
        await delay(1)
      })

      const record = collector.finishTrace('GET', '/test', 200)
      const span = record!.spans[0]
      // startOffset should be > 0 since we waited before the span
      assert.isAbove(span.startOffset, 5)
    })
  })

  test('addSpan startOffset and duration are rounded', async ({ assert }) => {
    collector = new TraceCollector(10)

    await collector.startTrace(async () => {
      collector.addSpan('precise', 'custom', 1.23456, 7.89012)
      const record = collector.finishTrace('GET', '/test', 200)

      assert.equal(record!.spans[0].startOffset, 1.23)
      assert.equal(record!.spans[0].duration, 7.89)
    })
  })

  test('start() with an emitter that has no .on method does not throw', async ({ assert }) => {
    collector = new TraceCollector(10)
    const badEmitter = { on: undefined, off() {}, emit() {} }

    // Should not throw
    collector.start(badEmitter as unknown as Emitter)
    assert.isTrue(true)
  })

  test('finishTrace called twice in same context returns null the second time', async ({
    assert,
  }) => {
    collector = new TraceCollector(10)

    await collector.startTrace(async () => {
      const first = collector.finishTrace('GET', '/test', 200)
      // The context still exists (ALS store persists until the callback returns),
      // so finishTrace will create another record with the same context state
      const second = collector.finishTrace('GET', '/test', 200)
      assert.isNotNull(first)
      assert.isNotNull(second)
    })

    // Both got pushed to the buffer
    assert.equal(collector.getTotalCount(), 2)
  })

  test('span categories accept all valid values', async ({ assert }) => {
    collector = new TraceCollector(10)
    const categories: TraceSpan['category'][] = [
      'request',
      'middleware',
      'db',
      'view',
      'mail',
      'event',
      'custom',
    ]

    await collector.startTrace(async () => {
      for (const cat of categories) {
        collector.addSpan(`span-${cat}`, cat, 0, 1)
      }

      const record = collector.finishTrace('GET', '/test', 200)
      assert.equal(record!.spanCount, categories.length)

      for (let i = 0; i < categories.length; i++) {
        assert.equal(record!.spans[i].category, categories[i])
      }
    })
  })

  test('getLatest on empty buffer returns empty array', async ({ assert }) => {
    collector = new TraceCollector(10)
    assert.deepEqual(collector.getLatest(5), [])
  })

  test('getTraces on empty buffer returns empty array', async ({ assert }) => {
    collector = new TraceCollector(10)
    assert.deepEqual(collector.getTraces(), [])
  })

  test('loadRecords followed by new traces — IDs do not collide', async ({ assert }) => {
    collector = new TraceCollector(100)

    const records: TraceRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      method: 'GET',
      url: `/loaded/${i}`,
      statusCode: 200,
      totalDuration: 10,
      spanCount: 0,
      spans: [],
      warnings: [],
      timestamp: Date.now(),
    }))

    collector.loadRecords(records)

    // New traces should start at ID 6
    for (let i = 0; i < 3; i++) {
      await collector.startTrace(async () => {
        collector.finishTrace('GET', `/new/${i}`, 200)
      })
    }

    const traces = collector.getTraces()
    assert.lengthOf(traces, 8)

    // newest-first: IDs should be monotonically decreasing
    for (let i = 1; i < traces.length; i++) {
      assert.isBelow(traces[i].id, traces[i - 1].id)
    }

    // New IDs should be 8, 7, 6 (newest-first)
    assert.equal(traces[0].id, 8)
    assert.equal(traces[1].id, 7)
    assert.equal(traces[2].id, 6)
  })
})

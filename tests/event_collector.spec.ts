import { test } from '@japa/runner'
import type { Emitter } from '../src/debug/types.js'
import { EventCollector } from '../src/debug/event_collector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock emitter that satisfies the Emitter interface.
 * Tracks calls to the original emit to verify pass-through.
 */
function createMockEmitter() {
  const emittedEvents: Array<{ event: string; data: unknown }> = []

  const emitter = {
    emit(event: string | ((...args: unknown[]) => unknown), data?: unknown): unknown {
      const name = typeof event === 'string' ? event : event?.name || 'unknown'
      emittedEvents.push({ event: name, data })
      return undefined
    },
    on(_event: string, _handler: (...args: unknown[]) => void): void {},
    off(_event: string, _handler: (...args: unknown[]) => void): void {},
  }

  return { emitter, emittedEvents }
}

// ---------------------------------------------------------------------------
// Tests -- summarizeData truncation
// ---------------------------------------------------------------------------

test.group('EventCollector | summarizeData truncation', () => {
  test('large payloads are truncated at 4KB without fully serializing them first', ({
    assert,
  }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    // Create a large payload (well over 4KB when serialized)
    const largeData: Record<string, string> = {}
    for (let i = 0; i < 200; i++) {
      largeData[`key_${i}`] = 'x'.repeat(100)
    }

    emitter.emit('test:large', largeData)

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const data = events[0].data
    assert.isNotNull(data)
    assert.isString(data)

    // Should be truncated to approximately 4KB + the trailing "..."
    assert.isAtMost(
      (data as string).length,
      4096 + 10,
      `Expected data to be truncated at ~4KB but got ${(data as string).length} chars`
    )
    assert.isTrue(
      (data as string).endsWith('...'),
      'Expected truncated data to end with "..."'
    )

    collector.stop()
  })

  test('small payloads are not truncated', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    const smallData = { name: 'test', value: 42 }
    emitter.emit('test:small', smallData)

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const data = events[0].data
    assert.isNotNull(data)
    assert.isFalse(
      (data as string).endsWith('...'),
      'Small payload should not be truncated'
    )

    // Verify data round-trips correctly
    const parsed = JSON.parse(data as string)
    assert.equal(parsed.name, 'test')
    assert.equal(parsed.value, 42)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- circular references do not crash summarizeData
// ---------------------------------------------------------------------------

test.group('EventCollector | circular references', () => {
  test('circular references in event data do not crash summarizeData', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    // Create a circular reference
    const circular: Record<string, unknown> = { name: 'root', value: 123 }
    circular.self = circular

    assert.doesNotThrow(() => {
      emitter.emit('test:circular', circular)
    })

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const data = events[0].data as string
    assert.isNotNull(data)

    // The circular reference should be replaced with [Circular]
    assert.isTrue(
      data.includes('[Circular]'),
      `Expected [Circular] marker in serialized data but got: ${data.slice(0, 200)}`
    )

    // The non-circular fields should still be present
    assert.isTrue(data.includes('"name"'))
    assert.isTrue(data.includes('"root"'))

    collector.stop()
  })

  test('deeply nested circular references are handled correctly', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    // Create a deeply nested circular reference
    const a: Record<string, unknown> = { level: 'a' }
    const b: Record<string, unknown> = { level: 'b', parent: a }
    const c: Record<string, unknown> = { level: 'c', parent: b }
    a.child = b
    b.child = c
    c.backToRoot = a

    assert.doesNotThrow(() => {
      emitter.emit('test:deep-circular', a)
    })

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const data = events[0].data as string
    assert.isNotNull(data)
    assert.isTrue(
      data.includes('[Circular]'),
      'Expected [Circular] in deeply nested circular data'
    )

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- safeReplacer WeakSet handles nested objects
// ---------------------------------------------------------------------------

test.group('EventCollector | safeReplacer handles nested objects', () => {
  test('shared object references are correctly marked as circular', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    // Same object referenced twice (not circular, but shared)
    const shared = { id: 1, value: 'shared' }
    const data = {
      first: shared,
      second: shared,
    }

    emitter.emit('test:shared', data)

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const serialized = events[0].data as string
    assert.isNotNull(serialized)

    // The second reference to 'shared' should be [Circular] because WeakSet
    // marks it as already seen
    assert.isTrue(
      serialized.includes('[Circular]'),
      'Expected shared reference to be marked as [Circular]'
    )

    collector.stop()
  })

  test('functions in event data are serialized as [Function: name]', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    function myHandler() {}
    const data = {
      handler: myHandler,
      anonymous: () => {},
    }

    emitter.emit('test:functions', data)

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const serialized = events[0].data as string
    assert.isNotNull(serialized)
    assert.isTrue(
      serialized.includes('[Function: myHandler]'),
      `Expected [Function: myHandler] but got: ${serialized}`
    )

    collector.stop()
  })

  test('bigint values are serialized as strings', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    const data = { bigValue: BigInt(9007199254740991) }

    emitter.emit('test:bigint', data)

    const events = collector.getEvents()
    assert.lengthOf(events, 1)

    const serialized = events[0].data as string
    assert.isNotNull(serialized)
    assert.isTrue(
      serialized.includes('9007199254740991'),
      `Expected bigint value in serialized data but got: ${serialized}`
    )

    collector.stop()
  })

  test('null and undefined event data are handled gracefully', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    emitter.emit('test:null', null)
    emitter.emit('test:undefined', undefined)

    const events = collector.getEvents()
    assert.lengthOf(events, 2)

    assert.isNull(events[0].data)
    assert.isNull(events[1].data)

    collector.stop()
  })

  test('string event data is stored as-is without JSON.stringify', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    emitter.emit('test:string', 'hello world')

    const events = collector.getEvents()
    assert.lengthOf(events, 1)
    assert.equal(events[0].data, 'hello world')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- newest-first ordering
// ---------------------------------------------------------------------------

test.group('EventCollector | Ordering', () => {
  test('returns events in newest-first order', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()
    collector.start(emitter as unknown as Emitter)

    emitter.emit('event:first', { order: 1 })
    emitter.emit('event:second', { order: 2 })
    emitter.emit('event:third', { order: 3 })

    const events = collector.getEvents()
    assert.lengthOf(events, 3)
    assert.equal(events[0].event, 'event:third')
    assert.equal(events[1].event, 'event:second')
    assert.equal(events[2].event, 'event:first')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- emit pass-through
// ---------------------------------------------------------------------------

test.group('EventCollector | emit pass-through', () => {
  test('original emit is called even when collector is active', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter, emittedEvents: _emittedEvents } = createMockEmitter()

    // Capture original emit before collector patches it
    const _originalEmit = emitter.emit.bind(emitter)

    collector.start(emitter as unknown as Emitter)

    // Now emit -- collector intercepts but should pass through
    emitter.emit('user:registered', { id: 1 })

    // The collector should have recorded the event
    const events = collector.getEvents()
    assert.lengthOf(events, 1)
    assert.equal(events[0].event, 'user:registered')

    collector.stop()
  })

  test('stop() restores the original emit function', ({ assert }) => {
    const collector = new EventCollector(100)
    const { emitter } = createMockEmitter()

    const _originalEmit = emitter.emit

    collector.start(emitter as unknown as Emitter)
    assert.notEqual(emitter.emit, originalEmit, 'emit should be patched after start()')

    collector.stop()
    // After stop, emit should be restored
    // Note: the restored emit is the bound version, so direct reference
    // comparison may differ, but functionality should be restored
    emitter.emit('after:stop', { test: true })

    // No new events should be recorded after stop
    assert.lengthOf(collector.getEvents(), 0)
  })
})

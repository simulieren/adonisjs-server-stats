import { test } from '@japa/runner'
import { processCollector } from '../src/collectors/process_collector.js'

// ---------------------------------------------------------------------------
// collect() return shape
// ---------------------------------------------------------------------------

test.group('processCollector | collect() return shape', () => {
  test('all expected fields are present', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, unknown>

    assert.property(result, 'nodeVersion')
    assert.property(result, 'uptime')
    assert.property(result, 'memHeapUsed')
    assert.property(result, 'memHeapTotal')
    assert.property(result, 'memRss')
    assert.property(result, 'cpuPercent')
    assert.property(result, 'eventLoopLag')

    collector.stop!()
  })

  test('all values are numbers except nodeVersion which is string', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, unknown>

    assert.isString(result.nodeVersion)
    assert.isNumber(result.uptime)
    assert.isNumber(result.memHeapUsed)
    assert.isNumber(result.memHeapTotal)
    assert.isNumber(result.memRss)
    assert.isNumber(result.cpuPercent)
    assert.isNumber(result.eventLoopLag)

    collector.stop!()
  })
})

// ---------------------------------------------------------------------------
// Value constraints
// ---------------------------------------------------------------------------

test.group('processCollector | value constraints', () => {
  test('cpuPercent is between 0 and 100', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, number>

    assert.isAtLeast(result.cpuPercent, 0)
    assert.isAtMost(result.cpuPercent, 100)

    collector.stop!()
  })

  test('memRss > 0 (process is running)', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, number>

    assert.isAbove(result.memRss, 0)

    collector.stop!()
  })

  test('uptime > 0', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, number>

    assert.isAbove(result.uptime, 0)

    collector.stop!()
  })
})

// ---------------------------------------------------------------------------
// name and label
// ---------------------------------------------------------------------------

test.group('processCollector | name and label', () => {
  test('name is "process"', ({ assert }) => {
    const collector = processCollector()

    assert.equal(collector.name, 'process')
  })

  test('label contains expected description', ({ assert }) => {
    const collector = processCollector()

    assert.isString(collector.label)
    assert.include(collector.label!, 'process')
    assert.include(collector.label!, 'cpu')
    assert.include(collector.label!, 'memory')
    assert.include(collector.label!, 'event loop')
    assert.include(collector.label!, 'uptime')
  })
})

// ---------------------------------------------------------------------------
// getConfig()
// ---------------------------------------------------------------------------

test.group('processCollector | getConfig()', () => {
  test('returns empty object', ({ assert }) => {
    const collector = processCollector()

    const config = collector.getConfig!()

    assert.deepEqual(config, {})
  })
})

// ---------------------------------------------------------------------------
// start/stop lifecycle
// ---------------------------------------------------------------------------

test.group('processCollector | start/stop lifecycle', () => {
  test('no errors on start() then stop()', ({ assert }) => {
    const collector = processCollector()

    assert.doesNotThrow(() => {
      collector.start!()
    })

    assert.doesNotThrow(() => {
      collector.stop!()
    })
  })

  test('double start() does not throw', ({ assert }) => {
    const collector = processCollector()

    assert.doesNotThrow(() => {
      collector.start!()
      collector.start!()
    })

    collector.stop!()
  })

  test('double stop() does not throw', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    assert.doesNotThrow(() => {
      collector.stop!()
      collector.stop!()
    })
  })

  test('collect() works after start() and before stop()', ({ assert }) => {
    const collector = processCollector()
    collector.start!()

    const result = collector.collect() as Record<string, unknown>
    assert.isNotEmpty(Object.keys(result))

    collector.stop!()
  })
})

import { test } from '@japa/runner'
import { StatsEngine } from '../src/engine/stats_engine.js'
import type { MetricCollector } from '../src/collectors/collector.js'
import type { MetricValue } from '../src/types.js'

/**
 * Creates a mock collector with configurable behavior.
 */
function createMockCollector(
  name: string,
  data: Record<string, MetricValue>,
  options?: {
    label?: string
    throwOnCollect?: boolean
    throwOnStart?: boolean
    throwOnStop?: boolean
    config?: Record<string, unknown>
  }
): MetricCollector & {
  startCalled: boolean
  stopCalled: boolean
  collectCallCount: number
} {
  const mock = {
    name,
    label: options?.label ?? `Mock ${name}`,
    startCalled: false,
    stopCalled: false,
    collectCallCount: 0,

    async collect(): Promise<Record<string, MetricValue>> {
      mock.collectCallCount++
      if (options?.throwOnCollect) throw new Error('collect failed')
      return data
    },

    async start(): Promise<void> {
      if (options?.throwOnStart) throw new Error('start failed')
      mock.startCalled = true
    },

    async stop(): Promise<void> {
      if (options?.throwOnStop) throw new Error('stop failed')
      mock.stopCalled = true
    },

    getConfig(): Record<string, unknown> {
      return options?.config ?? {}
    },
  }

  return mock
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

test.group('StatsEngine | constructor', () => {
  test('creates health entries for each collector with status healthy', ({ assert }) => {
    const c1 = createMockCollector('cpu', { cpuPercent: 50 })
    const c2 = createMockCollector('mem', { memRss: 1024 })

    const engine = new StatsEngine([c1, c2])
    const health = engine.getCollectorHealth()

    assert.lengthOf(health, 2)

    assert.equal(health[0].name, 'cpu')
    assert.equal(health[0].label, 'Mock cpu')
    assert.equal(health[0].status, 'healthy')
    assert.isNull(health[0].lastError)
    assert.isNull(health[0].lastErrorAt)

    assert.equal(health[1].name, 'mem')
    assert.equal(health[1].label, 'Mock mem')
    assert.equal(health[1].status, 'healthy')
    assert.isNull(health[1].lastError)
    assert.isNull(health[1].lastErrorAt)
  })

  test('uses collector name as label fallback when label is undefined', ({ assert }) => {
    const collector: MetricCollector = {
      name: 'nolabel',
      collect() {
        return { foo: 1 }
      },
    }

    const engine = new StatsEngine([collector])
    const health = engine.getCollectorHealth()

    assert.equal(health[0].label, 'nolabel')
  })
})

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

test.group('StatsEngine | start', () => {
  test('calls start() on each collector sequentially', async ({ assert }) => {
    const order: string[] = []
    const c1 = createMockCollector('a', {})
    const c2 = createMockCollector('b', {})

    // Override start to track call order
    c1.start = async () => {
      order.push('a')
    }
    c2.start = async () => {
      order.push('b')
    }

    const engine = new StatsEngine([c1, c2])
    await engine.start()

    assert.deepEqual(order, ['a', 'b'])
  })

  test('handles collectors without a start method', async ({ assert }) => {
    const collector: MetricCollector = {
      name: 'nostart',
      collect() {
        return { x: 1 }
      },
      // No start() defined
    }

    const engine = new StatsEngine([collector])
    // Should not throw
    await engine.start()
    assert.isTrue(true)
  })

  test('catches errors from collector start() and continues', async ({ assert }) => {
    const c1 = createMockCollector('failing', {}, { throwOnStart: true })
    const c2 = createMockCollector('healthy', { x: 1 })
    const engine = new StatsEngine([c1, c2])

    // start() should not throw — errors are caught and logged
    await engine.start()

    // The healthy collector should still have been started
    assert.isTrue(c2.startCalled)
  })
})

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

test.group('StatsEngine | stop', () => {
  test('calls stop() on each collector', async ({ assert }) => {
    const c1 = createMockCollector('a', {})
    const c2 = createMockCollector('b', {})

    const engine = new StatsEngine([c1, c2])
    await engine.stop()

    assert.isTrue(c1.stopCalled)
    assert.isTrue(c2.stopCalled)
  })

  test('sets all collector health to stopped', async ({ assert }) => {
    const c1 = createMockCollector('a', { x: 1 })
    const c2 = createMockCollector('b', { y: 2 })

    const engine = new StatsEngine([c1, c2])
    await engine.stop()

    const health = engine.getCollectorHealth()
    assert.equal(health[0].status, 'stopped')
    assert.equal(health[1].status, 'stopped')
  })

  test('handles collectors without a stop method', async ({ assert }) => {
    const collector: MetricCollector = {
      name: 'nostop',
      collect() {
        return { x: 1 }
      },
    }

    const engine = new StatsEngine([collector])
    await engine.stop()

    const health = engine.getCollectorHealth()
    assert.equal(health[0].status, 'stopped')
  })
})

// ---------------------------------------------------------------------------
// collect()
// ---------------------------------------------------------------------------

test.group('StatsEngine | collect', () => {
  test('merges results from multiple collectors and adds timestamp', async ({ assert }) => {
    const c1 = createMockCollector('cpu', { cpuPercent: 42 })
    const c2 = createMockCollector('mem', { memRss: 2048, memHeapUsed: 1024 })

    const engine = new StatsEngine([c1, c2])
    const beforeTs = Date.now()
    const result = await engine.collect()
    const afterTs = Date.now()

    assert.equal(result.cpuPercent, 42)
    assert.equal(result.memRss, 2048)
    assert.equal(result.memHeapUsed, 1024)
    assert.property(result, 'timestamp')
    assert.isTrue((result.timestamp as number) >= beforeTs)
    assert.isTrue((result.timestamp as number) <= afterTs)
  })

  test('error isolation: one collector throwing returns {} for that collector', async ({
    assert,
  }) => {
    const good = createMockCollector('good', { healthy: true })
    const bad = createMockCollector('bad', {}, { throwOnCollect: true })

    const engine = new StatsEngine([good, bad])
    const result = await engine.collect()

    // Good collector's metrics are present
    assert.equal(result.healthy, true)
    // Timestamp is still added
    assert.property(result, 'timestamp')
  })

  test('error isolation: health updates to errored with error message', async ({ assert }) => {
    const bad = createMockCollector('bad', {}, { throwOnCollect: true })

    const engine = new StatsEngine([bad])
    await engine.collect()

    const health = engine.getCollectorHealth()
    assert.equal(health[0].status, 'errored')
    assert.equal(health[0].lastError, 'collect failed')
    assert.isNotNull(health[0].lastErrorAt)
    assert.isTrue(typeof health[0].lastErrorAt === 'number')
  })

  test('health recovery: errored collector returns to healthy on successful collect', async ({
    assert,
  }) => {
    let shouldThrow = true
    const collector: MetricCollector = {
      name: 'flaky',
      label: 'Flaky Collector',
      collect() {
        if (shouldThrow) throw new Error('temporary failure')
        return { ok: true }
      },
    }

    const engine = new StatsEngine([collector])

    // First collect: errors
    await engine.collect()
    let health = engine.getCollectorHealth()
    assert.equal(health[0].status, 'errored')

    // Second collect: succeeds
    shouldThrow = false
    await engine.collect()
    health = engine.getCollectorHealth()
    assert.equal(health[0].status, 'healthy')
  })

  test('repeated errors: only first error triggers warning (wasHealthy check)', async ({
    assert,
  }) => {
    // We verify this by checking the health status transitions.
    // On first error, wasHealthy is true -> log.warn is called.
    // On second error, wasHealthy is false -> log.warn is NOT called.
    // We cannot directly assert on log.warn without mocking, but we
    // can verify the health state remains 'errored' and the lastError
    // / lastErrorAt fields update on each collect.
    const bad = createMockCollector('bad', {}, { throwOnCollect: true })
    const engine = new StatsEngine([bad])

    // First collect: transitions healthy -> errored
    await engine.collect()
    const health1 = engine.getCollectorHealth()
    assert.equal(health1[0].status, 'errored')
    const firstErrorAt = health1[0].lastErrorAt

    // Small delay to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 5))

    // Second collect: stays errored, lastErrorAt updates
    await engine.collect()
    const health2 = engine.getCollectorHealth()
    assert.equal(health2[0].status, 'errored')
    assert.equal(health2[0].lastError, 'collect failed')
    assert.isNotNull(health2[0].lastErrorAt)
    // lastErrorAt should be updated on each error
    assert.isTrue(health2[0].lastErrorAt! >= firstErrorAt!)
  })

  test('collect increments call count on each collector', async ({ assert }) => {
    const c = createMockCollector('counter', { val: 1 })
    const engine = new StatsEngine([c])

    await engine.collect()
    await engine.collect()
    await engine.collect()

    assert.equal(c.collectCallCount, 3)
  })
})

// ---------------------------------------------------------------------------
// getLatestStats()
// ---------------------------------------------------------------------------

test.group('StatsEngine | getLatestStats', () => {
  test('returns empty object before any collection', ({ assert }) => {
    const engine = new StatsEngine([createMockCollector('x', { v: 1 })])
    const stats = engine.getLatestStats()

    assert.deepEqual(stats, {})
  })

  test('returns last collected result after collection', async ({ assert }) => {
    const c = createMockCollector('cpu', { cpuPercent: 55 })
    const engine = new StatsEngine([c])

    await engine.collect()
    const stats = engine.getLatestStats()

    assert.equal(stats.cpuPercent, 55)
    assert.property(stats, 'timestamp')
  })

  test('returns the most recent collect result, not older ones', async ({ assert }) => {
    let counter = 0
    const collector: MetricCollector = {
      name: 'inc',
      collect() {
        counter++
        return { count: counter }
      },
    }

    const engine = new StatsEngine([collector])

    await engine.collect()
    await engine.collect()
    await engine.collect()

    const stats = engine.getLatestStats()
    assert.equal(stats.count, 3)
  })
})

// ---------------------------------------------------------------------------
// getCollectorHealth()
// ---------------------------------------------------------------------------

test.group('StatsEngine | getCollectorHealth', () => {
  test('returns array matching collector count', ({ assert }) => {
    const collectors = [
      createMockCollector('a', {}),
      createMockCollector('b', {}),
      createMockCollector('c', {}),
    ]

    const engine = new StatsEngine(collectors)
    const health = engine.getCollectorHealth()

    assert.lengthOf(health, 3)
    assert.equal(health[0].name, 'a')
    assert.equal(health[1].name, 'b')
    assert.equal(health[2].name, 'c')
  })

  test('returns a new array instance on each call', ({ assert }) => {
    const engine = new StatsEngine([createMockCollector('x', {})])
    const h1 = engine.getCollectorHealth()
    const h2 = engine.getCollectorHealth()

    assert.notStrictEqual(h1, h2)
    assert.deepEqual(h1, h2)
  })
})

// ---------------------------------------------------------------------------
// getCollectorConfigs()
// ---------------------------------------------------------------------------

test.group('StatsEngine | getCollectorConfigs', () => {
  test('calls getConfig() on each collector and returns results', ({ assert }) => {
    const c1 = createMockCollector('cpu', {}, { config: { interval: 3000 } })
    const c2 = createMockCollector('http', {}, { config: { maxRecords: 10000, windowMs: 60000 } })

    const engine = new StatsEngine([c1, c2])
    const configs = engine.getCollectorConfigs()

    assert.lengthOf(configs, 2)
    assert.equal(configs[0].name, 'cpu')
    assert.deepEqual(configs[0].config, { interval: 3000 })
    assert.equal(configs[1].name, 'http')
    assert.deepEqual(configs[1].config, { maxRecords: 10000, windowMs: 60000 })
  })

  test('returns empty config when collector has no getConfig method', ({ assert }) => {
    const collector: MetricCollector = {
      name: 'bare',
      collect() {
        return { x: 1 }
      },
      // No getConfig defined
    }

    const engine = new StatsEngine([collector])
    const configs = engine.getCollectorConfigs()

    assert.lengthOf(configs, 1)
    assert.equal(configs[0].name, 'bare')
    assert.deepEqual(configs[0].config, {})
  })
})

// ---------------------------------------------------------------------------
// Zero collectors
// ---------------------------------------------------------------------------

test.group('StatsEngine | zero collectors', () => {
  test('constructor with empty array works', ({ assert }) => {
    const engine = new StatsEngine([])
    const health = engine.getCollectorHealth()
    assert.lengthOf(health, 0)
  })

  test('start() with no collectors does not throw', async ({ assert }) => {
    const engine = new StatsEngine([])
    await engine.start()
    assert.isTrue(true)
  })

  test('stop() with no collectors does not throw', async ({ assert }) => {
    const engine = new StatsEngine([])
    await engine.stop()
    assert.isTrue(true)
  })

  test('collect() with no collectors returns only timestamp', async ({ assert }) => {
    const engine = new StatsEngine([])
    const result = await engine.collect()

    assert.property(result, 'timestamp')
    const keys = Object.keys(result)
    assert.lengthOf(keys, 1)
    assert.equal(keys[0], 'timestamp')
  })

  test('getLatestStats() with no collectors returns empty before collect', ({ assert }) => {
    const engine = new StatsEngine([])
    assert.deepEqual(engine.getLatestStats(), {})
  })

  test('getCollectorConfigs() with no collectors returns empty array', ({ assert }) => {
    const engine = new StatsEngine([])
    assert.deepEqual(engine.getCollectorConfigs(), [])
  })
})

// ---------------------------------------------------------------------------
// Key collisions
// ---------------------------------------------------------------------------

test.group('StatsEngine | key collisions', () => {
  test('later collector keys overwrite earlier ones via Object.assign', async ({ assert }) => {
    const c1 = createMockCollector('first', { shared: 'from-first', onlyFirst: true })
    const c2 = createMockCollector('second', { shared: 'from-second', onlySecond: true })

    const engine = new StatsEngine([c1, c2])
    const result = await engine.collect()

    // 'shared' should be overwritten by the second collector
    assert.equal(result.shared, 'from-second')
    // Unique keys from both collectors are present
    assert.equal(result.onlyFirst, true)
    assert.equal(result.onlySecond, true)
  })

  test('timestamp key from a collector is overwritten by engine timestamp', async ({
    assert,
  }) => {
    const collector = createMockCollector('sneaky', { timestamp: 0 })
    const engine = new StatsEngine([collector])

    const beforeTs = Date.now()
    const result = await engine.collect()

    // The engine's timestamp (appended last) overwrites the collector's value
    assert.isTrue((result.timestamp as number) >= beforeTs)
  })
})

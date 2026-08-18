import { test } from '@japa/runner'
import { adonisQueueCollector } from '../src/collectors/adonisjs_queue_collector.js'
import type { QueueStoreReader, QueueCounts } from '../src/dashboard/integrations/adonisjs_queue_store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReader(
  counts: QueueCounts,
  workerCount: number
): QueueStoreReader {
  return {
    async getCounts()               { return { ...counts } },
    async getWorkerCount()          { return workerCount },
    async listJobs()                { return { jobs: [], total: 0 } },
    async getJob()                  { return null },
    async retryJob()                { return false },
  }
}

// ---------------------------------------------------------------------------
// name and getConfig
// ---------------------------------------------------------------------------

test.group('adonisQueueCollector | name and getConfig', () => {
  test('name is "queue"', ({ assert }) => {
    const collector = adonisQueueCollector()

    assert.equal(collector.name, 'queue')
  })

  test('getConfig returns { driver: "auto", source: "@adonisjs/queue" }', ({ assert }) => {
    const collector = adonisQueueCollector()

    const config = collector.getConfig!()

    assert.deepEqual(config, { driver: 'auto', source: '@adonisjs/queue' })
  })
})

// ---------------------------------------------------------------------------
// collect() — null reader path (zero defaults)
// ---------------------------------------------------------------------------

test.group('adonisQueueCollector | collect() zero defaults when no reader', () => {
  test('returns all zeros when resolveReader returns null', async ({ assert }) => {
    const collector = adonisQueueCollector({}, { resolveReader: async () => null })

    const result = await collector.collect()

    assert.deepEqual(result, {
      queueActive:      0,
      queueWaiting:     0,
      queueDelayed:     0,
      queueFailed:      0,
      queueWorkerCount: 0,
    })
  })

  test('all zero-default keys are present', async ({ assert }) => {
    const collector = adonisQueueCollector({}, { resolveReader: async () => null })

    const result = await collector.collect() as Record<string, unknown>

    assert.property(result, 'queueActive')
    assert.property(result, 'queueWaiting')
    assert.property(result, 'queueDelayed')
    assert.property(result, 'queueFailed')
    assert.property(result, 'queueWorkerCount')
  })

  test('returns zeros when resolveReader throws', async ({ assert }) => {
    const collector = adonisQueueCollector({}, {
      resolveReader: async () => { throw new Error('not installed') },
    })

    const result = await collector.collect()

    assert.deepEqual(result, {
      queueActive:      0,
      queueWaiting:     0,
      queueDelayed:     0,
      queueFailed:      0,
      queueWorkerCount: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// collect() — mapping path (reader returns real counts)
// ---------------------------------------------------------------------------

test.group('adonisQueueCollector | collect() maps reader counts', () => {
  test('maps getCounts() + getWorkerCount() into expected output shape', async ({ assert }) => {
    const reader = fakeReader(
      { active: 2, waiting: 5, delayed: 1, completed: 9, failed: 3 },
      4
    )
    const collector = adonisQueueCollector({}, { resolveReader: async () => reader })

    const result = await collector.collect()

    assert.deepEqual(result, {
      queueActive:      2,
      queueWaiting:     5,
      queueDelayed:     1,
      queueFailed:      3,
      queueWorkerCount: 4,
    })
  })

  test('completed count is not included in the output (not a tracked metric)', async ({ assert }) => {
    const reader = fakeReader(
      { active: 0, waiting: 0, delayed: 0, completed: 100, failed: 0 },
      0
    )
    const collector = adonisQueueCollector({}, { resolveReader: async () => reader })

    const result = await collector.collect() as Record<string, unknown>

    assert.notProperty(result, 'queueCompleted')
  })

  test('queueWorkerCount uses getWorkerCount() result', async ({ assert }) => {
    const reader = fakeReader(
      { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 },
      7
    )
    const collector = adonisQueueCollector({}, { resolveReader: async () => reader })

    const result = await collector.collect() as Record<string, unknown>

    assert.equal(result.queueWorkerCount, 7)
  })

  test('all metric values are numbers', async ({ assert }) => {
    const reader = fakeReader(
      { active: 1, waiting: 2, delayed: 3, completed: 4, failed: 5 },
      6
    )
    const collector = adonisQueueCollector({}, { resolveReader: async () => reader })

    const result = await collector.collect() as Record<string, unknown>

    assert.isNumber(result.queueActive)
    assert.isNumber(result.queueWaiting)
    assert.isNumber(result.queueDelayed)
    assert.isNumber(result.queueFailed)
    assert.isNumber(result.queueWorkerCount)
  })
})

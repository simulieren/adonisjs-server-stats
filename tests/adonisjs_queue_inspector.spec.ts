import { test } from '@japa/runner'
import { AdonisQueueInspector } from '../src/dashboard/integrations/adonisjs_queue_inspector.js'
import type { QueueStoreReader, QueueCounts } from '../src/dashboard/integrations/adonisjs_queue_store.js'
import type { QueueJobDetail, QueueJobListResult, QueueJobSummary } from '../src/dashboard/integrations/queue_inspector_contract.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A minimal fake ApplicationService — only what AdonisQueueInspector needs. */
function makeApp(opts: { queueManagerThrows?: boolean } = {}) {
  return {
    config: {
      get(key: string) {
        if (key === 'queue') {
          return { default: 'database', adapters: { database: {} } }
        }
        return undefined
      },
    },
    container: {
      async make(binding: string): Promise<unknown> {
        if (binding === 'queue.manager') {
          if (opts.queueManagerThrows) throw new Error('queue.manager not registered')
          return {
            use() {
              return { constructor: { name: 'KnexAdapter' } }
            },
          }
        }
        throw new Error(`Unknown binding: ${binding}`)
      },
    },
  } as unknown as Parameters<typeof AdonisQueueInspector.isAvailable>[0]
}

/** A fully-populated fake QueueStoreReader with controllable responses. */
function makeFakeReader(overrides: Partial<QueueStoreReader> = {}): QueueStoreReader {
  const defaultSummary: QueueJobSummary = {
    id: 'job-1',
    name: 'SendEmail',
    status: 'completed',
    data: { email: 'alice@example.com' },
    payload: { email: 'alice@example.com' },
    attempts: 1,
    maxAttempts: 3,
    progress: 0,
    failedReason: null,
    createdAt: 1700000000000,
    timestamp: 1700000000000,
    processedAt: 1700000001000,
    finishedAt: 1700000002000,
    duration: 1000,
  }
  const defaultDetail: QueueJobDetail = {
    ...defaultSummary,
    stackTrace: [],
    returnValue: null,
    opts: {},
  }
  const defaultCounts: QueueCounts = {
    active: 2,
    waiting: 5,
    delayed: 1,
    completed: 42,
    failed: 3,
  }

  return {
    async getCounts() { return { ...defaultCounts } },
    async listJobs(_status, _page, _perPage) {
      return { jobs: [defaultSummary], total: 1 }
    },
    async getJob(_id) { return defaultDetail },
    async retryJob(_id) { return true },
    async getWorkerCount() { return 0 },
    ...overrides,
  }
}

/**
 * Build an AdonisQueueInspector with a fake resolver instead of the real
 * resolveFromApplication, using the internal seam added for testing.
 */
function makeInspector(
  resolveReader: () => Promise<QueueStoreReader | null>,
  app?: Parameters<typeof AdonisQueueInspector.isAvailable>[0]
): AdonisQueueInspector {
  const fakeApp = app ?? makeApp()
  // The second constructor arg activates the internal seam — see source comment.
  return new (AdonisQueueInspector as unknown as new (
    app: unknown,
    resolver: (app: unknown) => Promise<QueueStoreReader | null>
  ) => AdonisQueueInspector)(fakeApp, () => resolveReader())
}

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · isAvailable', () => {
  test('returns true when container.make("queue.manager") resolves', async ({ assert }) => {
    const app = makeApp({ queueManagerThrows: false })
    assert.isTrue(await AdonisQueueInspector.isAvailable(app as unknown as Parameters<typeof AdonisQueueInspector.isAvailable>[0]))
  })

  test('returns false when container.make("queue.manager") throws', async ({ assert }) => {
    const app = makeApp({ queueManagerThrows: true })
    assert.isFalse(await AdonisQueueInspector.isAvailable(app as unknown as Parameters<typeof AdonisQueueInspector.isAvailable>[0]))
  })
})

// ---------------------------------------------------------------------------
// getOverview
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · getOverview', () => {
  test('maps reader.getCounts() and hardcodes paused:0', async ({ assert }) => {
    const reader = makeFakeReader({
      async getCounts() {
        return { active: 10, waiting: 20, delayed: 3, completed: 100, failed: 7 }
      },
    })
    const inspector = makeInspector(async () => reader)

    const overview = await inspector.getOverview()

    assert.equal(overview.active, 10)
    assert.equal(overview.waiting, 20)
    assert.equal(overview.delayed, 3)
    assert.equal(overview.completed, 100)
    assert.equal(overview.failed, 7)
    assert.equal(overview.paused, 0, 'paused is always 0 — @adonisjs/queue has no paused concept')
  })

  test('returns safe defaults (all zeros) when reader is null', async ({ assert }) => {
    const inspector = makeInspector(async () => null)

    const overview = await inspector.getOverview()

    assert.equal(overview.active, 0)
    assert.equal(overview.waiting, 0)
    assert.equal(overview.delayed, 0)
    assert.equal(overview.completed, 0)
    assert.equal(overview.failed, 0)
    assert.equal(overview.paused, 0)
  })

  test('returns safe defaults when reader.getCounts() throws', async ({ assert }) => {
    const reader = makeFakeReader({
      async getCounts() { throw new Error('db error') },
    })
    const inspector = makeInspector(async () => reader)

    const overview = await inspector.getOverview()

    assert.equal(overview.active, 0)
    assert.equal(overview.waiting, 0)
    assert.equal(overview.paused, 0)
  })
})

// ---------------------------------------------------------------------------
// listJobs
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · listJobs', () => {
  test('delegates to reader.listJobs and returns its result', async ({ assert }) => {
    const reader = makeFakeReader()
    const inspector = makeInspector(async () => reader)

    const result = await inspector.listJobs('completed', 1, 10)

    assert.equal(result.total, 1)
    assert.lengthOf(result.jobs, 1)
    assert.equal(result.jobs[0].id, 'job-1')
  })

  test('maps status "paused" → "all" when calling reader.listJobs', async ({ assert }) => {
    const received: string[] = []
    const reader = makeFakeReader({
      async listJobs(status) {
        received.push(status)
        return { jobs: [], total: 0 }
      },
    })
    const inspector = makeInspector(async () => reader)

    await inspector.listJobs('paused')

    assert.equal(received[0], 'all', '"paused" status must be translated to "all" for the store')
  })

  test('passes other statuses through unchanged', async ({ assert }) => {
    const received: string[] = []
    const reader = makeFakeReader({
      async listJobs(status) {
        received.push(status)
        return { jobs: [], total: 0 }
      },
    })
    const inspector = makeInspector(async () => reader)

    await inspector.listJobs('failed')

    assert.equal(received[0], 'failed')
  })

  test('returns {jobs:[], total:0} when reader is null', async ({ assert }) => {
    const inspector = makeInspector(async () => null)

    const result = await inspector.listJobs('all')

    assert.deepEqual(result, { jobs: [], total: 0 })
  })

  test('returns {jobs:[], total:0} when reader.listJobs throws', async ({ assert }) => {
    const reader = makeFakeReader({
      async listJobs() { throw new Error('store error') },
    })
    const inspector = makeInspector(async () => reader)

    const result = await inspector.listJobs('all')

    assert.deepEqual(result, { jobs: [], total: 0 })
  })
})

// ---------------------------------------------------------------------------
// getJob
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · getJob', () => {
  test('delegates to reader.getJob and returns its result', async ({ assert }) => {
    const reader = makeFakeReader()
    const inspector = makeInspector(async () => reader)

    const job = await inspector.getJob('job-1')

    assert.isNotNull(job)
    assert.equal(job!.id, 'job-1')
    assert.equal(job!.name, 'SendEmail')
    assert.isArray(job!.stackTrace)
    assert.isNull(job!.returnValue)
  })

  test('returns null when reader is null', async ({ assert }) => {
    const inspector = makeInspector(async () => null)

    assert.isNull(await inspector.getJob('job-1'))
  })

  test('returns null when reader.getJob throws', async ({ assert }) => {
    const reader = makeFakeReader({
      async getJob() { throw new Error('not found') },
    })
    const inspector = makeInspector(async () => reader)

    assert.isNull(await inspector.getJob('missing-id'))
  })

  test('returns null when reader.getJob returns null', async ({ assert }) => {
    const reader = makeFakeReader({
      async getJob() { return null },
    })
    const inspector = makeInspector(async () => reader)

    assert.isNull(await inspector.getJob('no-such-id'))
  })
})

// ---------------------------------------------------------------------------
// retryJob
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · retryJob', () => {
  test('returns true when reader.retryJob succeeds', async ({ assert }) => {
    const reader = makeFakeReader({ async retryJob() { return true } })
    const inspector = makeInspector(async () => reader)

    assert.isTrue(await inspector.retryJob('job-1'))
  })

  test('returns false when reader.retryJob returns false', async ({ assert }) => {
    const reader = makeFakeReader({ async retryJob() { return false } })
    const inspector = makeInspector(async () => reader)

    assert.isFalse(await inspector.retryJob('job-1'))
  })

  test('returns false when reader is null', async ({ assert }) => {
    const inspector = makeInspector(async () => null)

    assert.isFalse(await inspector.retryJob('job-1'))
  })

  test('returns false when reader.retryJob throws', async ({ assert }) => {
    const reader = makeFakeReader({
      async retryJob() { throw new Error('store error') },
    })
    const inspector = makeInspector(async () => reader)

    assert.isFalse(await inspector.retryJob('job-1'))
  })
})

// ---------------------------------------------------------------------------
// Concurrency / race-condition guard
// ---------------------------------------------------------------------------

test.group('AdonisQueueInspector · concurrency race guard', () => {
  test(
    'getOverview() + listJobs() fired concurrently both receive real data and resolver runs exactly once',
    async ({ assert }) => {
      let resolverCallCount = 0

      const reader = makeFakeReader({
        async getCounts() {
          return { active: 7, waiting: 3, delayed: 0, completed: 50, failed: 2 }
        },
        async listJobs() {
          return { jobs: [makeFakeReader().getJob as unknown as QueueJobSummary], total: 99 }
        },
      })

      // The resolver is intentionally slow: it resolves after a microtask tick
      // so the second concurrent caller sees #readerPromise as still-null if
      // the implementation stores a boolean flag instead of the promise.
      const slowResolver = (): Promise<QueueStoreReader | null> => {
        resolverCallCount++
        // Resolve after one tick — slow enough to expose the race window
        return new Promise((resolve) => setTimeout(() => resolve(reader), 0))
      }

      const inspector = makeInspector(slowResolver)

      // Fire both calls simultaneously — this is the exact pattern the real
      // dashboard handler uses (Promise.all over getOverview + listJobs).
      const [overview, listResult] = await Promise.all([
        inspector.getOverview(),
        inspector.listJobs('all'),
      ])

      // Both calls must return real data (not empty defaults)
      assert.equal(overview.active, 7, 'getOverview should see real active count')
      assert.equal(overview.waiting, 3, 'getOverview should see real waiting count')
      assert.equal(overview.paused, 0, 'paused is always 0')
      assert.equal(listResult.total, 99, 'listJobs should see real total')

      // The resolver must have been invoked exactly once — the promise is
      // memoized so the second concurrent caller reuses the in-flight promise
      // rather than kicking off a second resolution.
      assert.equal(
        resolverCallCount,
        1,
        'reader resolver must be called exactly once even under concurrent access'
      )
    }
  )

  test('subsequent calls after resolution also reuse the cached promise (no re-resolution)', async ({
    assert,
  }) => {
    let resolverCallCount = 0
    const reader = makeFakeReader()

    const inspector = makeInspector(async () => {
      resolverCallCount++
      return reader
    })

    // First call resolves the reader
    await inspector.getOverview()
    // Second sequential call must not invoke the resolver again
    await inspector.listJobs('all')
    await inspector.getJob('job-1')

    assert.equal(resolverCallCount, 1, 'resolver should only ever be called once')
  })
})

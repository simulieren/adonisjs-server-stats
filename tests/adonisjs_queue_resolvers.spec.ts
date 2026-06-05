import { test } from '@japa/runner'
import {
  resolveFromApplication,
  resolveFromContainer,
} from '../src/dashboard/integrations/adonisjs_queue_store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake ApplicationLike.
 *
 * `adapterName` controls what queueManager.use().constructor.name returns —
 * 'KnexAdapter' forces the database driver, 'RedisAdapter' forces redis,
 * anything else forces the noop reader path.
 */
function fakeApp(options: {
  adapterName?: string
  throwOnQueueManager?: boolean
  throwOnLucid?: boolean
  throwOnRedis?: boolean
}) {
  const {
    adapterName = 'KnexAdapter',
    throwOnQueueManager = false,
    throwOnLucid = false,
    throwOnRedis = false,
  } = options

  return {
    config: {
      get(key: string): unknown {
        if (key === 'queue') {
          return { default: 'database', adapters: { database: {} } }
        }
        return undefined
      },
    },
    container: {
      async make(binding: string): Promise<unknown> {
        if (binding === 'queue.manager') {
          if (throwOnQueueManager) throw new Error('queue.manager not registered')
          return {
            use() {
              // Return a plain object whose constructor.name matches the adapter
              const proto = { constructor: { name: adapterName } }
              return Object.create(proto)
            },
          }
        }
        if (binding === 'lucid.db') {
          if (throwOnLucid) throw new Error('lucid.db not registered')
          return {
            primaryConnectionName: 'sqlite',
            connection(_name?: string) {
              return { getWriteClient: () => ({}) }
            },
          }
        }
        if (binding === 'redis') {
          if (throwOnRedis) throw new Error('redis not registered')
          return {
            connection(_name?: string) { return {} },
          }
        }
        throw new Error(`unknown binding: ${binding}`)
      },
    },
  }
}

// ---------------------------------------------------------------------------
// resolveFromApplication
// ---------------------------------------------------------------------------

test.group('resolveFromApplication | happy path', () => {
  test('returns a non-null reader when queue.manager resolves and driver is database', async ({
    assert,
  }) => {
    const reader = await resolveFromApplication(fakeApp({ adapterName: 'KnexAdapter' }))

    assert.isNotNull(reader)
  })

  test('returned reader has required QueueStoreReader interface', async ({ assert }) => {
    const reader = await resolveFromApplication(fakeApp({ adapterName: 'KnexAdapter' }))

    assert.isNotNull(reader)
    assert.isFunction(reader!.getCounts)
    assert.isFunction(reader!.listJobs)
    assert.isFunction(reader!.getJob)
    assert.isFunction(reader!.retryJob)
    assert.isFunction(reader!.getWorkerCount)
  })

  test('returns a non-null noop reader for unknown driver (e.g. SyncAdapter)', async ({
    assert,
  }) => {
    // Unknown driver → noop reader, still non-null
    const reader = await resolveFromApplication(fakeApp({ adapterName: 'SyncAdapter' }))

    assert.isNotNull(reader)
    const counts = await reader!.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('noop reader getWorkerCount returns 0 for unknown driver', async ({ assert }) => {
    const reader = await resolveFromApplication(fakeApp({ adapterName: 'SyncAdapter' }))

    assert.isNotNull(reader)
    const count = await reader!.getWorkerCount()
    assert.equal(count, 0)
  })
})

test.group('resolveFromApplication | error handling', () => {
  test('returns null when container.make("queue.manager") throws', async ({ assert }) => {
    const reader = await resolveFromApplication(fakeApp({ throwOnQueueManager: true }))

    assert.isNull(reader)
  })

  test('returns a reader (not null) even when lucid.db throws (db service absent)', async ({
    assert,
  }) => {
    // lucid.db missing → falls through to noop reader for database driver
    const reader = await resolveFromApplication(
      fakeApp({ adapterName: 'KnexAdapter', throwOnLucid: true })
    )

    // buildQueueStoreReader returns noop reader (not null) when db is absent
    assert.isNotNull(reader)
    const counts = await reader!.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('returns a reader (not null) even when redis throws (redis service absent)', async ({
    assert,
  }) => {
    const reader = await resolveFromApplication(
      fakeApp({ adapterName: 'RedisAdapter', throwOnRedis: true })
    )

    assert.isNotNull(reader)
    const counts = await reader!.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })
})

// ---------------------------------------------------------------------------
// resolveFromContainer
// ---------------------------------------------------------------------------

test.group('resolveFromContainer | full app object', () => {
  test('delegates to resolveFromApplication when given a full app (has config + container)', async ({
    assert,
  }) => {
    const app = fakeApp({ adapterName: 'KnexAdapter' })

    // Full app-like → same result as calling resolveFromApplication directly
    const reader = await resolveFromContainer(app)

    assert.isNotNull(reader)
    assert.isFunction(reader!.getCounts)
  })

  test('returns null when full app queue.manager throws', async ({ assert }) => {
    const app = fakeApp({ throwOnQueueManager: true })

    const reader = await resolveFromContainer(app)

    assert.isNull(reader)
  })
})

test.group('resolveFromContainer | bare container', () => {
  test('resolves "app" binding and delegates config reading to it', async ({ assert }) => {
    // A bare container: no `config` property, but has `make`.
    // make('app') returns a minimal app with config and container.
    const innerApp = fakeApp({ adapterName: 'KnexAdapter' })
    const bareContainer = {
      async make(binding: string): Promise<unknown> {
        if (binding === 'app') return innerApp
        return innerApp.container.make(binding)
      },
    }

    const reader = await resolveFromContainer(bareContainer)

    assert.isNotNull(reader)
  })

  test('returns null when bare container make("app") throws', async ({ assert }) => {
    const bareContainer = {
      async make(binding: string): Promise<unknown> {
        throw new Error(`binding "${binding}" not found`)
      },
    }

    const reader = await resolveFromContainer(bareContainer)

    assert.isNull(reader)
  })
})

import { test } from '@japa/runner'
import { InspectorManager } from '../src/dashboard/inspector_manager.js'
import { QueueInspector } from '../src/dashboard/integrations/queue_inspector.js'
import { AdonisQueueInspector } from '../src/dashboard/integrations/adonisjs_queue_inspector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake rlanz/bull-queue manager — only needs .get() / .getOrSet(). */
function makeFakeRlanzManager() {
  return {
    get: (_name: string) => null,
    getOrSet: (_name: string) => null as unknown as ReturnType<typeof makeFakeRlanzManager>['get'],
  }
}

/** Fake @adonisjs/queue manager — present but not called further. */
function makeFakeQueueManager() {
  return { dispatch: async () => {} }
}

/**
 * Build a fake ApplicationService whose container.make() is instrumented
 * with a call counter.
 *
 * @param allow  Which bindings should resolve (others throw).
 */
function makeFakeApp(allow: Set<string>) {
  let makeCallCount = 0

  const fakeApp = {
    container: {
      make: async (binding: string) => {
        makeCallCount++
        if (!allow.has(binding)) throw new Error(`not bound: ${binding}`)
        if (binding === 'rlanz/queue') return makeFakeRlanzManager()
        if (binding === 'queue.manager') return makeFakeQueueManager()
        throw new Error(`unexpected binding: ${binding}`)
      },
    },
    config: {
      get() {
        return { default: 'database', adapters: { database: {} } }
      },
    },
    getMakeCallCount() {
      return makeCallCount
    },
  }

  return fakeApp
}

// ---------------------------------------------------------------------------
// InspectorManager · getQueueInspector
// ---------------------------------------------------------------------------

test.group('InspectorManager · getQueueInspector', () => {
  test('returns a QueueInspector when rlanz/queue resolves', async ({ assert }) => {
    const app = makeFakeApp(new Set(['rlanz/queue']))
    const manager = new InspectorManager(app as never)

    const inspector = await manager.getQueueInspector()

    assert.instanceOf(inspector, QueueInspector)
    assert.equal(inspector!.constructor.name, 'QueueInspector')

    // Contract methods exist on the returned inspector
    assert.isFunction(inspector!.getOverview)
    assert.isFunction(inspector!.listJobs)
    assert.isFunction(inspector!.getJob)
    assert.isFunction(inspector!.retryJob)
  })

  test('returns an AdonisQueueInspector when rlanz/queue throws but queue.manager resolves', async ({
    assert,
  }) => {
    // Only 'queue.manager' is allowed; 'rlanz/queue' throws
    const app = makeFakeApp(new Set(['queue.manager']))
    const manager = new InspectorManager(app as never)

    const inspector = await manager.getQueueInspector()

    assert.instanceOf(inspector, AdonisQueueInspector)
    assert.equal(inspector!.constructor.name, 'AdonisQueueInspector')

    // Contract methods exist on the returned inspector
    assert.isFunction(inspector!.getOverview)
    assert.isFunction(inspector!.listJobs)
    assert.isFunction(inspector!.getJob)
    assert.isFunction(inspector!.retryJob)
  })

  test('returns null when both rlanz/queue and queue.manager throw', async ({ assert }) => {
    const app = makeFakeApp(new Set()) // nothing resolves
    const manager = new InspectorManager(app as never)

    const inspector = await manager.getQueueInspector()

    assert.isNull(inspector)
  })

  test('caches null and short-circuits on subsequent calls (no re-resolution)', async ({
    assert,
  }) => {
    const app = makeFakeApp(new Set()) // nothing resolves
    const manager = new InspectorManager(app as never)

    const first = await manager.getQueueInspector()
    const callsAfterFirst = app.getMakeCallCount()

    const second = await manager.getQueueInspector()
    const callsAfterSecond = app.getMakeCallCount()

    assert.isNull(first)
    assert.isNull(second)

    // No additional make() calls after the first resolution attempt
    assert.equal(callsAfterSecond, callsAfterFirst)
  })

  test('caches the resolved inspector and does not re-run isAvailable on subsequent calls', async ({
    assert,
  }) => {
    const app = makeFakeApp(new Set(['rlanz/queue']))
    const manager = new InspectorManager(app as never)

    const first = await manager.getQueueInspector()
    const callsAfterFirst = app.getMakeCallCount()

    const second = await manager.getQueueInspector()
    const callsAfterSecond = app.getMakeCallCount()

    // Both calls return the same instance
    assert.strictEqual(first, second)
    assert.instanceOf(first, QueueInspector)

    // No additional make() calls after the initial resolution
    assert.equal(callsAfterSecond, callsAfterFirst)
  })
})

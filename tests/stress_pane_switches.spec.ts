import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FetchCounters {
  active: number
  peak: number
  completed: number
  aborted: number
}

function createMockFetchHandler(delayMs: number, c: FetchCounters) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    c.active++
    c.peak = Math.max(c.peak, c.active)

    if (init?.signal?.aborted) {
      c.active--
      c.aborted++
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
      c.active--
      c.completed++
      const urlStr = typeof url === 'string' ? url : url.toString()
      return new Response(JSON.stringify({ url: urlStr, ts: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      c.active--
      c.aborted++
      throw err
    }
  }
}

function createFetchTracker(delayMs: number = 50) {
  const c: FetchCounters = { active: 0, peak: 0, completed: 0, aborted: 0 }
  globalThis.fetch = createMockFetchHandler(delayMs, c) as typeof fetch

  return {
    get activeFetches() { return c.active },
    get peakActiveFetches() { return c.peak },
    get completedFetches() { return c.completed },
    get abortedFetches() { return c.aborted },
    get totalFetches() { return c.completed + c.aborted },
  }
}

function createDebugCallbacks() {
  const calls = {
    data: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: [] as unknown[],
  }
  return {
    calls,
    onData: (d: unknown) => calls.data.push(d),
    onLoading: (l: boolean) => calls.loading.push(l),
    onError: (e: Error | null) => calls.errors.push(e),
    onUnauthorized: (e: unknown) => calls.unauthorized.push(e),
  }
}

const DEBUG_TABS = ['queries', 'events', 'logs', 'routes', 'emails', 'timeline'] as const

function createDebugCtrl(
  cbs: Omit<ReturnType<typeof createDebugCallbacks>, 'calls'>,
  opts: { refreshInterval?: number } = {}
) {
  return new DebugDataController({
    baseUrl: '',
    ...cbs,
    refreshInterval: opts.refreshInterval ?? 60_000,
  })
}

// ---------------------------------------------------------------------------
// Stress | 100 debug pane switches (DebugDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 100 debug pane switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 rapid switchTab calls -- at most 5 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(200)

    assert.isAtMost(tracker.completedFetches, 5)
    assert.isAtLeast(tracker.abortedFetches, 95)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Expected no errors but got ${realErrors.length}`)
    ctrl.stop()
  })

  test('100 switches -- no timer leak after stop()', async ({ assert }) => {
    createFetchTracker(10)
    const { calls: _calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs, { refreshInterval: 100 })

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    const postStopTracker = createFetchTracker(10)
    await sleep(500)
    assert.equal(postStopTracker.completedFetches, 0)
  })
})

test.group('Stress | 100 debug pane switches (data & state)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('100 switches -- only last tab data arrives', async ({ assert }) => {
    createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 100; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(200)

    const lastTabPath = '/admin/api/debug/routes'
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    assert.isTrue(dataWithUrls.length >= 1, 'Expected at least one onData call')
    for (const d of dataWithUrls) {
      assert.isTrue(d.url === lastTabPath, `Expected ${lastTabPath} but got ${d.url}`)
    }
    ctrl.stop()
  })

  test('100 start/stop cycles -- no accumulated state', async ({ assert }) => {
    createFetchTracker(10)
    const { calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    for (let i = 0; i < 100; i++) {
      ctrl.start(DEBUG_TABS[i % DEBUG_TABS.length])
      ctrl.stop()
    }
    await sleep(500)

    const postStopTracker = createFetchTracker(10)
    await sleep(500)

    assert.equal(postStopTracker.completedFetches, 0)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Unexpected errors: ${realErrors.length}`)
  })
})

// ---------------------------------------------------------------------------
// Stress | 1000 debug pane switches (DebugDataController)
// ---------------------------------------------------------------------------

test.group('Stress | 1000 debug pane switches', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 rapid switchTab calls -- at most 5 fetches complete', async ({ assert }) => {
    const tracker = createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(300)

    assert.isAtMost(tracker.completedFetches, 5)
    assert.isAtLeast(tracker.abortedFetches, 990)
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0, `Expected no errors but got ${realErrors.length}`)
    ctrl.stop()
  })

  test('1000 switches -- completes in under 2 seconds', async ({ assert }) => {
    createFetchTracker(10)
    const { calls: _calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    const start = performance.now()
    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(200)
    ctrl.stop()

    assert.isBelow(performance.now() - start, 2000)
  })
})

test.group('Stress | 1000 debug pane switches (leaks & data)', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('1000 switches -- no timer leak after stop()', async ({ assert }) => {
    createFetchTracker(10)
    const { calls: _calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs, { refreshInterval: 100 })

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }

    await sleep(300)
    ctrl.stop()
    await sleep(200)

    const postStopTracker = createFetchTracker(10)
    await sleep(500)
    assert.equal(postStopTracker.completedFetches, 0)
  })

  test('1000 switches -- only last tab data arrives', async ({ assert }) => {
    createFetchTracker(50)
    const { calls, ...cbs } = createDebugCallbacks()
    const ctrl = createDebugCtrl(cbs)

    ctrl.start('queries')
    for (let i = 0; i < 1000; i++) {
      ctrl.switchTab(DEBUG_TABS[i % DEBUG_TABS.length])
    }
    await sleep(300)

    const lastTabPath = '/admin/api/debug/routes'
    const dataWithUrls = calls.data.filter(
      (d: unknown) => d && typeof d === 'object' && 'url' in d
    ) as Array<{ url: string }>

    assert.isTrue(dataWithUrls.length >= 1, 'Expected at least one onData call')
    for (const d of dataWithUrls) {
      assert.isTrue(d.url === lastTabPath, `Expected ${lastTabPath} but got ${d.url}`)
    }
    ctrl.stop()
  })
})

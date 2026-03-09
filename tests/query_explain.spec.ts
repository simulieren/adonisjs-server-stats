import { test } from '@japa/runner'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

interface MockRoute {
  method: string
  url: string
}

/**
 * Create a mock for `globalThis.fetch` that captures requests and returns
 * JSON responses based on URL pattern matching.
 */
function mockFetch(handler: (url: string, method: string) => unknown) {
  const requests: MockRoute[] = []
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const urlStr = typeof url === 'string' ? url : url.toString()
    const method = init?.method || 'GET'
    requests.push({ method, url: urlStr })
    const body = handler(urlStr, method)
    // Simulate 404 for unmatched routes
    if (body === null) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return requests
}

function createCallbacks() {
  const calls = {
    data: [] as unknown[],
    pagination: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: 0,
  }
  return {
    calls,
    callbacks: {
      onData: (d: unknown) => calls.data.push(d),
      onPagination: (m: unknown) => calls.pagination.push(m),
      onLoading: (l: boolean) => calls.loading.push(l),
      onError: (e: Error | null) => calls.errors.push(e),
      onUnauthorized: () => {
        calls.unauthorized++
      },
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createController(callbacks: ReturnType<typeof createCallbacks>['callbacks']) {
  return new DashboardDataController({
    baseUrl: '',
    endpoint: '/__stats/api',
    authToken: undefined,
    section: 'queries',
    perPage: 50,
    callbacks,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('Query EXPLAIN feature', (group) => {
  group.each.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('explainQuery uses GET method, not POST', async ({ assert }) => {
    const requests = mockFetch((url, method) => {
      if (url.includes('/queries/42/explain') && method === 'GET') {
        return { queryId: 42, sql: 'SELECT * FROM users', plan: [{ 'Node Type': 'Seq Scan' }] }
      }
      if (url.includes('/queries')) {
        return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
      }
      return null
    })
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    const api = ctrl.getApi()
    const result = await api.explainQuery(42)

    ctrl.stop()

    // The explain request should use GET
    const explainReq = requests.find((r) => r.url.includes('/queries/42/explain'))
    assert.isDefined(explainReq, 'Expected an explain request')
    assert.equal(explainReq!.method, 'GET', 'explainQuery should use GET, not POST')
    assert.property(result, 'plan')
  })

  test('mutate uses POST which causes 404 for GET-only explain route', async ({ assert }) => {
    const requests = mockFetch((url, method) => {
      // Simulate real server: only GET is registered for explain
      if (url.includes('/queries/42/explain') && method === 'GET') {
        return { queryId: 42, sql: 'SELECT 1', plan: [] }
      }
      if (url.includes('/queries/42/explain') && method === 'POST') {
        return null // 404 — no POST route
      }
      if (url.includes('/queries')) {
        return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
      }
      return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
    })
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    // mutate defaults to POST — this is the bug
    let threw = false
    try {
      await ctrl.mutate('queries/42/explain')
    } catch {
      threw = true
    }

    ctrl.stop()

    // mutate sends POST
    const postReq = requests.find(
      (r) => r.url.includes('/queries/42/explain') && r.method === 'POST'
    )
    assert.isDefined(postReq, 'mutate should have sent a POST request')
    assert.isTrue(threw, 'POST to GET-only route should fail')
  })

  test('explainQuery returns plan data on success', async ({ assert }) => {
    const expectedPlan = [
      { 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Startup Cost': 0.0 },
    ]
    mockFetch((url) => {
      if (url.includes('/queries/7/explain')) {
        return { queryId: 7, sql: 'SELECT * FROM users', plan: expectedPlan }
      }
      return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
    })
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    const result = (await ctrl.getApi().explainQuery(7)) as {
      queryId: number
      plan: unknown[]
    }

    ctrl.stop()

    assert.equal(result.queryId, 7)
    assert.deepEqual(result.plan, expectedPlan)
  })

  test('explainQuery handles server error gracefully', async ({ assert }) => {
    mockFetch((url) => {
      if (url.includes('/explain')) {
        return { error: 'EXPLAIN failed', message: 'relation "deleted_table" does not exist' }
      }
      return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
    })
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    const result = (await ctrl.getApi().explainQuery(99)) as {
      error?: string
      message?: string
    }

    ctrl.stop()

    assert.equal(result.error, 'EXPLAIN failed')
    assert.equal(result.message, 'relation "deleted_table" does not exist')
  })

  test('explainQuery URL is correctly constructed with query ID', async ({ assert }) => {
    const requests = mockFetch((url) => {
      if (url.includes('/explain')) {
        return { queryId: 123, sql: 'SELECT 1', plan: [] }
      }
      return { data: [], meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 } }
    })
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    await ctrl.getApi().explainQuery(123)
    ctrl.stop()

    const explainReq = requests.find((r) => r.url.includes('/explain'))
    assert.isDefined(explainReq)
    assert.include(explainReq!.url, '/__stats/api/queries/123/explain')
  })
})

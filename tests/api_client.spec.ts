import { test } from '@japa/runner'
import { ApiClient, ApiError, UnauthorizedError } from '../src/core/api-client.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string
  init: RequestInit
}

/**
 * Creates a mock fetch that resolves with a controlled Response and captures
 * the request details for assertions.
 */
function mockFetch(
  response: Partial<Response> & { ok: boolean; status: number },
  jsonBody: unknown = {}
) {
  const captured: CapturedRequest[] = []

  const textBody =
    typeof response.body === 'string' ? response.body : JSON.stringify(jsonBody)

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    captured.push({ url, init: init ?? {} })

    return {
      ok: response.ok,
      status: response.status,
      json: async () => jsonBody,
      text: async () => textBody,
    } as Response
  }) as typeof globalThis.fetch

  return captured
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

test.group('UnauthorizedError', () => {
  test('default status is 403', ({ assert }) => {
    const err = new UnauthorizedError()
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'UnauthorizedError')
    assert.equal(err.status, 403)
    assert.include(err.message, '403')
  })

  test('custom status is preserved', ({ assert }) => {
    const err = new UnauthorizedError(401)
    assert.equal(err.status, 401)
    assert.include(err.message, '401')
  })
})

test.group('ApiError', () => {
  test('status and body are set correctly', ({ assert }) => {
    const err = new ApiError(500, 'Internal Server Error')
    assert.instanceOf(err, Error)
    assert.equal(err.name, 'ApiError')
    assert.equal(err.status, 500)
    assert.equal(err.body, 'Internal Server Error')
    assert.include(err.message, '500')
  })
})

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

test.group('ApiClient | constructor', () => {
  test('strips trailing slash from baseUrl', ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { ok: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com/' })

    // Trigger a request so we can inspect the URL
    client.fetch('/test').then(() => {
      assert.equal(captured[0].url, 'https://api.example.com/test')
    })
  })

  test('strips multiple trailing slashes from baseUrl', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { ok: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com///' })

    await client.fetch('/test')
    assert.equal(captured[0].url, 'https://api.example.com/test')
  })

  test('leaves baseUrl without trailing slash unchanged', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { ok: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.fetch('/path')
    assert.equal(captured[0].url, 'https://api.example.com/path')
  })
})

// ---------------------------------------------------------------------------
// fetch — auth strategies
// ---------------------------------------------------------------------------

test.group('ApiClient | fetch auth', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('Bearer token auth sets Authorization header and credentials=omit', async ({
    assert,
  }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { data: 1 })
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      authToken: 'my-secret-token',
    })

    await client.fetch('/resource')

    const headers = captured[0].init.headers as Record<string, string>
    assert.equal(headers['Authorization'], 'Bearer my-secret-token')
    assert.equal(headers['Accept'], 'application/json')
    assert.equal(captured[0].init.credentials, 'omit')
  })

  test('cookie auth sets credentials=include and no Authorization header', async ({
    assert,
  }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { data: 1 })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.fetch('/resource')

    const headers = captured[0].init.headers as Record<string, string>
    assert.notProperty(headers, 'Authorization')
    assert.equal(headers['Accept'], 'application/json')
    assert.equal(captured[0].init.credentials, 'include')
  })
})

// ---------------------------------------------------------------------------
// fetch — abort guard
// ---------------------------------------------------------------------------

test.group('ApiClient | fetch abort guard', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('throws AbortError if signal.aborted is true after fetch resolves', async ({
    assert,
  }) => {
    const controller = new AbortController()

    // Mock fetch that sets signal.aborted right after the "network" call completes
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      // Simulate: fetch resolved, but the signal was aborted during the request
      controller.abort()

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: 'should not reach' }),
        text: async () => '',
      } as Response
    }) as typeof globalThis.fetch

    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    try {
      await client.fetch('/resource', { signal: controller.signal })
      assert.fail('Expected an AbortError to be thrown')
    } catch (error: unknown) {
      assert.instanceOf(error, DOMException)
      assert.equal(error.name, 'AbortError')
    }
  })
})

// ---------------------------------------------------------------------------
// fetch — error responses
// ---------------------------------------------------------------------------

test.group('ApiClient | fetch error responses', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('401 response throws UnauthorizedError with status 401', async ({ assert }) => {
    mockFetch({ ok: false, status: 401 })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    try {
      await client.fetch('/secure')
      assert.fail('Expected UnauthorizedError')
    } catch (error: unknown) {
      assert.instanceOf(error, UnauthorizedError)
      assert.equal(error.status, 401)
    }
  })

  test('403 response throws UnauthorizedError with status 403', async ({ assert }) => {
    mockFetch({ ok: false, status: 403 })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    try {
      await client.fetch('/forbidden')
      assert.fail('Expected UnauthorizedError')
    } catch (error: unknown) {
      assert.instanceOf(error, UnauthorizedError)
      assert.equal(error.status, 403)
    }
  })

  test('500 response throws ApiError with status and body', async ({ assert }) => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Internal Server Error',
      } as Response
    }) as typeof globalThis.fetch

    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    try {
      await client.fetch('/broken')
      assert.fail('Expected ApiError')
    } catch (error: unknown) {
      assert.instanceOf(error, ApiError)
      assert.equal(error.status, 500)
      assert.equal(error.body, 'Internal Server Error')
    }
  })

  test('non-OK response where response.text() fails throws ApiError with empty body', async ({
    assert,
  }) => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('no json')
        },
        text: async () => {
          throw new Error('body stream already consumed')
        },
      } as unknown as Response
    }) as typeof globalThis.fetch

    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    try {
      await client.fetch('/bad-gateway')
      assert.fail('Expected ApiError')
    } catch (error: unknown) {
      assert.instanceOf(error, ApiError)
      assert.equal(error.status, 502)
      assert.equal(error.body, '')
    }
  })
})

// ---------------------------------------------------------------------------
// fetch — successful JSON response
// ---------------------------------------------------------------------------

test.group('ApiClient | fetch success', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('successful response returns parsed JSON', async ({ assert }) => {
    const payload = { users: [{ id: 1, name: 'Alice' }] }
    mockFetch({ ok: true, status: 200 }, payload)
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    const result = await client.fetch<{ users: { id: number; name: string }[] }>('/users')
    assert.deepEqual(result, payload)
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

test.group('ApiClient | get', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('appends query string to path', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { results: [] })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.get('/path', 'foo=bar&baz=42')
    assert.equal(captured[0].url, 'https://api.example.com/path?foo=bar&baz=42')
  })

  test('omits query string when not provided', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { results: [] })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.get('/path')
    assert.equal(captured[0].url, 'https://api.example.com/path')
  })

  test('omits query string when undefined', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { results: [] })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.get('/path', undefined)
    assert.equal(captured[0].url, 'https://api.example.com/path')
  })
})

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

test.group('ApiClient | post', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('with body sets Content-Type and stringifies', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { created: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    const body = { name: 'Test', value: 123 }
    await client.post('/items', body)

    const headers = captured[0].init.headers as Record<string, string>
    assert.equal(headers['Content-Type'], 'application/json')
    assert.equal(captured[0].init.method, 'POST')
    assert.equal(captured[0].init.body, JSON.stringify(body))
  })

  test('without body does not set Content-Type', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { ok: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.post('/trigger')

    const headers = captured[0].init.headers as Record<string, string>
    assert.notProperty(headers, 'Content-Type')
    assert.equal(captured[0].init.method, 'POST')
    assert.notProperty(captured[0].init, 'body')
  })
})

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

test.group('ApiClient | delete', (group) => {
  let originalFetch: typeof globalThis.fetch
  group.setup(() => {
    originalFetch = globalThis.fetch
  })
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('sends DELETE method', async ({ assert }) => {
    const captured = mockFetch({ ok: true, status: 200 }, { deleted: true })
    const client = new ApiClient({ baseUrl: 'https://api.example.com' })

    await client.delete('/items/42')

    assert.equal(captured[0].init.method, 'DELETE')
    assert.equal(captured[0].url, 'https://api.example.com/items/42')
  })
})

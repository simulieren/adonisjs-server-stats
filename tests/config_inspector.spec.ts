import { test } from '@japa/runner'
import { ConfigInspector } from '../src/dashboard/integrations/config_inspector.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockApp(configData: Record<string, unknown> = {}) {
  let callCount = 0
  const app = {
    config: {
      all: () => {
        callCount++
        return configData
      },
    },
    getCallCount: () => callCount,
  }
  return app
}

// ---------------------------------------------------------------------------
// Sanitization tests
// ---------------------------------------------------------------------------

test.group('ConfigInspector - sanitization', () => {
  test('redacts sensitive keys', ({ assert }) => {
    const app = createMockApp({ password: 'secret123', appName: 'MyApp' })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    assert.deepEqual(result.config.password, {
      __redacted: true,
      display: '••••••••',
      value: 'secret123',
    })
    assert.equal(result.config.appName, 'MyApp')
  })

  test('redacts sensitive key patterns', ({ assert }) => {
    const app = createMockApp({
      api_key: 'ak-123',
      SECRET: 'shhh',
      TOKEN: 'tok-456',
      auth: 'bearer xyz',
      private: 'priv-data',
      dsn: 'sentry://abc@sentry.io/123',
      safe_value: 'visible',
    })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    assert.property(result.config.api_key as any, '__redacted')
    assert.property(result.config.SECRET as any, '__redacted')
    assert.property(result.config.TOKEN as any, '__redacted')
    assert.property(result.config.auth as any, '__redacted')
    assert.property(result.config.private as any, '__redacted')
    assert.property(result.config.dsn as any, '__redacted')
    assert.equal(result.config.safe_value, 'visible')
  })

  test('redacts email values regardless of key name', ({ assert }) => {
    const app = createMockApp({ contact: 'user@example.com' })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    assert.deepEqual(result.config.contact, {
      __redacted: true,
      display: '••••••••',
      value: 'user@example.com',
    })
  })

  test('redacts URLs with credentials', ({ assert }) => {
    const app = createMockApp({ databaseUrl: 'postgres://user:pass@host/db' })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    assert.deepEqual(result.config.databaseUrl, {
      __redacted: true,
      display: '••••••••',
      value: 'postgres://user:pass@host/db',
    })
  })

  test('does not redact booleans and numbers', ({ assert }) => {
    const app = createMockApp({ debug: true, port: 3000 })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    assert.equal(result.config.debug, true)
    assert.equal(result.config.port, 3000)
  })

  test('handles nested objects and redacts deeply nested sensitive keys', ({ assert }) => {
    const app = createMockApp({
      db: {
        connection: {
          password: 'x',
          host: 'localhost',
        },
      },
    })
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getConfig()

    const db = result.config.db as Record<string, any>
    const connection = db.connection as Record<string, any>

    assert.deepEqual(connection.password, {
      __redacted: true,
      display: '••••••••',
      value: 'x',
    })
    assert.equal(connection.host, 'localhost')
  })

  test('handles circular references without throwing', ({ assert }) => {
    const circular: Record<string, any> = { name: 'root' }
    circular.self = circular

    const app = createMockApp(circular)
    const inspector = new ConfigInspector(app as any)

    assert.doesNotThrow(() => {
      const result = inspector.getConfig()
      const config = result.config as Record<string, any>
      assert.equal(config.name, 'root')
      assert.equal(config.self, '[Circular]')
    })
  })
})

// ---------------------------------------------------------------------------
// Env var tests
// ---------------------------------------------------------------------------

test.group('ConfigInspector - env', (group) => {
  const savedEnv: Record<string, string | undefined> = {}
  const testKeys = [
    'TEST_CI_PASSWORD',
    'TEST_CI_APP_NAME',
    'TEST_CI_ALPHA',
    'TEST_CI_ZEBRA',
    'TEST_CI_MIDDLE',
  ]

  group.setup(() => {
    for (const key of testKeys) {
      savedEnv[key] = process.env[key]
    }
  })

  group.teardown(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test('getEnvVars returns keys in sorted order', ({ assert }) => {
    process.env.TEST_CI_ZEBRA = 'z'
    process.env.TEST_CI_ALPHA = 'a'
    process.env.TEST_CI_MIDDLE = 'm'

    const app = createMockApp()
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getEnvVars()

    const keys = Object.keys(result.env)
    const testSubset = keys.filter((k) => k.startsWith('TEST_CI_'))

    assert.deepEqual(
      testSubset,
      [...testSubset].sort()
    )
  })

  test('redacts sensitive env vars', ({ assert }) => {
    process.env.TEST_CI_PASSWORD = 'super-secret'
    process.env.TEST_CI_APP_NAME = 'my-app'

    const app = createMockApp()
    const inspector = new ConfigInspector(app as any)
    const result = inspector.getEnvVars()

    const passwordEntry = result.env.TEST_CI_PASSWORD as any
    assert.property(passwordEntry, '__redacted')
    assert.equal(passwordEntry.__redacted, true)
    assert.equal(passwordEntry.value, 'super-secret')

    assert.equal(result.env.TEST_CI_APP_NAME, 'my-app')
  })
})

// ---------------------------------------------------------------------------
// Caching tests
// ---------------------------------------------------------------------------

test.group('ConfigInspector - caching', () => {
  test('getConfig caches result and calls config.all() only once', ({ assert }) => {
    const app = createMockApp({ foo: 'bar' })
    const inspector = new ConfigInspector(app as any)

    const first = inspector.getConfig()
    const second = inspector.getConfig()

    assert.equal(app.getCallCount(), 1)
    assert.deepEqual(first, second)
  })

  test('getEnvVars caches result on repeated calls', ({ assert }) => {
    const app = createMockApp()
    const inspector = new ConfigInspector(app as any)

    const first = inspector.getEnvVars()
    const second = inspector.getEnvVars()

    assert.strictEqual(first, second)
  })

  test('cache serves stored data without re-calling config.all()', ({ assert }) => {
    let returnValue: Record<string, unknown> = { version: 'v1' }
    let callCount = 0
    const app = {
      config: {
        all: () => {
          callCount++
          return returnValue
        },
      },
    }

    const inspector = new ConfigInspector(app as any)

    const first = inspector.getConfig()
    assert.equal((first.config as any).version, 'v1')
    assert.equal(callCount, 1)

    // Change what the mock would return
    returnValue = { version: 'v2' }

    // Second call should still return cached v1
    const second = inspector.getConfig()
    assert.equal((second.config as any).version, 'v1')
    assert.equal(callCount, 1)
  })

  test('getConfig and getEnvVars share cacheTimestamp', ({ assert }) => {
    const app = createMockApp({ key: 'value' })
    const inspector = new ConfigInspector(app as any)

    // Call getConfig first — sets cacheTimestamp
    inspector.getConfig()
    assert.equal(app.getCallCount(), 1)

    // Call getEnvVars — should also be within cache TTL (shares timestamp)
    const envResult = inspector.getEnvVars()
    assert.isObject(envResult.env)

    // Call getConfig again — should still be cached
    inspector.getConfig()
    assert.equal(app.getCallCount(), 1)
  })
})

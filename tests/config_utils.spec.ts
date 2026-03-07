import { test } from '@japa/runner'
import {
  isRedactedValue,
  flattenConfig,
  formatFlatValue,
  countLeaves,
  collectTopLevelObjectKeys,
  matchesConfigSearch,
  shouldRedact,
} from '../src/core/config-utils.js'
import type { RedactedValue, ConfigValue } from '../src/core/config-utils.js'

// ---------------------------------------------------------------------------
// isRedactedValue
// ---------------------------------------------------------------------------

test.group('isRedactedValue', () => {
  test('returns true for a valid redacted object', ({ assert }) => {
    const val: RedactedValue = { __redacted: true, display: '***', value: 'secret' }
    assert.isTrue(isRedactedValue(val))
  })

  test('returns false for null', ({ assert }) => {
    assert.isFalse(isRedactedValue(null))
  })

  test('returns false for undefined', ({ assert }) => {
    assert.isFalse(isRedactedValue(undefined))
  })

  test('returns false for an array', ({ assert }) => {
    assert.isFalse(isRedactedValue([1, 2, 3]))
  })

  test('returns false for a plain object without __redacted', ({ assert }) => {
    assert.isFalse(isRedactedValue({ foo: 'bar' }))
  })

  test('returns false for an object with __redacted set to false', ({ assert }) => {
    assert.isFalse(isRedactedValue({ __redacted: false } as unknown as ConfigValue))
  })

  test('returns false for a string', ({ assert }) => {
    assert.isFalse(isRedactedValue('hello'))
  })

  test('returns false for a number', ({ assert }) => {
    assert.isFalse(isRedactedValue(42))
  })

  test('returns false for a boolean', ({ assert }) => {
    assert.isFalse(isRedactedValue(true))
  })
})

// ---------------------------------------------------------------------------
// flattenConfig
// ---------------------------------------------------------------------------

test.group('flattenConfig', () => {
  test('returns a single entry for a primitive string value', ({ assert }) => {
    const result = flattenConfig('hello', 'key')
    assert.deepEqual(result, [{ path: 'key', value: 'hello' }])
  })

  test('returns a single entry for a primitive number value', ({ assert }) => {
    const result = flattenConfig(42, 'num')
    assert.deepEqual(result, [{ path: 'num', value: 42 }])
  })

  test('returns a single entry for a boolean value', ({ assert }) => {
    const result = flattenConfig(true, 'flag')
    assert.deepEqual(result, [{ path: 'flag', value: true }])
  })

  test('returns a single entry for null', ({ assert }) => {
    const result = flattenConfig(null, 'key')
    assert.deepEqual(result, [{ path: 'key', value: null }])
  })

  test('returns a single entry for undefined', ({ assert }) => {
    const result = flattenConfig(undefined, 'key')
    assert.deepEqual(result, [{ path: 'key', value: undefined }])
  })

  test('flattens a flat object into entries', ({ assert }) => {
    const result = flattenConfig({ a: 1, b: 'two' })
    assert.deepEqual(result, [
      { path: 'a', value: 1 },
      { path: 'b', value: 'two' },
    ])
  })

  test('flattens a nested object with dot-paths', ({ assert }) => {
    const result = flattenConfig({ app: { name: 'myApp', port: 3000 } })
    assert.deepEqual(result, [
      { path: 'app.name', value: 'myApp' },
      { path: 'app.port', value: 3000 },
    ])
  })

  test('does not recurse into arrays (treats them as leaf)', ({ assert }) => {
    const result = flattenConfig({ items: [1, 2, 3] })
    assert.deepEqual(result, [{ path: 'items', value: [1, 2, 3] }])
  })

  test('does not recurse into redacted values (treats them as leaf)', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: '***', value: 'secret' }
    const result = flattenConfig({ secret: redacted })
    assert.deepEqual(result, [{ path: 'secret', value: redacted }])
  })

  test('returns an empty array for an empty object', ({ assert }) => {
    const result = flattenConfig({})
    assert.deepEqual(result, [])
  })

  test('handles deeply nested objects', ({ assert }) => {
    const result = flattenConfig({ a: { b: { c: 'deep' } } })
    assert.deepEqual(result, [{ path: 'a.b.c', value: 'deep' }])
  })

  test('uses prefix when provided for root objects', ({ assert }) => {
    const result = flattenConfig({ x: 1 }, 'root')
    assert.deepEqual(result, [{ path: 'root.x', value: 1 }])
  })

  test('handles mixed nested and flat keys', ({ assert }) => {
    const result = flattenConfig({ a: 1, b: { c: 2, d: { e: 3 } } })
    assert.deepEqual(result, [
      { path: 'a', value: 1 },
      { path: 'b.c', value: 2 },
      { path: 'b.d.e', value: 3 },
    ])
  })
})

// ---------------------------------------------------------------------------
// formatFlatValue
// ---------------------------------------------------------------------------

test.group('formatFlatValue', () => {
  test('formats null as "null" with dim color', ({ assert }) => {
    const result = formatFlatValue(null)
    assert.equal(result.text, 'null')
    assert.equal(result.color, 'var(--ss-dim)')
  })

  test('formats undefined as "null" with dim color', ({ assert }) => {
    const result = formatFlatValue(undefined)
    assert.equal(result.text, 'null')
    assert.equal(result.color, 'var(--ss-dim)')
  })

  test('formats boolean true with green color', ({ assert }) => {
    const result = formatFlatValue(true)
    assert.equal(result.text, 'true')
    assert.equal(result.color, 'var(--ss-green-fg)')
  })

  test('formats boolean false with red color', ({ assert }) => {
    const result = formatFlatValue(false)
    assert.equal(result.text, 'false')
    assert.equal(result.color, 'var(--ss-red-fg)')
  })

  test('formats a number with amber color', ({ assert }) => {
    const result = formatFlatValue(42)
    assert.equal(result.text, '42')
    assert.equal(result.color, 'var(--ss-amber-fg)')
  })

  test('formats an array with items in brackets with purple color', ({ assert }) => {
    const result = formatFlatValue([1, 'two', 3])
    assert.equal(result.text, '[1, two, 3]')
    assert.equal(result.color, 'var(--ss-purple-fg)')
  })

  test('formats an empty array as "[]" with purple color', ({ assert }) => {
    const result = formatFlatValue([])
    assert.equal(result.text, '[]')
    assert.equal(result.color, 'var(--ss-purple-fg)')
  })

  test('formats array with null/undefined items as "null"', ({ assert }) => {
    const result = formatFlatValue([null, undefined])
    assert.equal(result.text, '[null, null]')
  })

  test('formats array with object items as JSON strings', ({ assert }) => {
    const result = formatFlatValue([{ a: 1 }] as ConfigValue)
    assert.equal(result.text, '[{"a":1}]')
  })

  test('formats a plain object as JSON with dim color', ({ assert }) => {
    const result = formatFlatValue({ foo: 'bar' } as ConfigValue)
    assert.equal(result.text, '{"foo":"bar"}')
    assert.equal(result.color, 'var(--ss-dim)')
  })

  test('formats a string with no color', ({ assert }) => {
    const result = formatFlatValue('hello')
    assert.equal(result.text, 'hello')
    assert.isUndefined(result.color)
  })

  test('formats an empty string with no color', ({ assert }) => {
    const result = formatFlatValue('')
    assert.equal(result.text, '')
    assert.isUndefined(result.color)
  })

  test('formats number 0 with amber color', ({ assert }) => {
    const result = formatFlatValue(0)
    assert.equal(result.text, '0')
    assert.equal(result.color, 'var(--ss-amber-fg)')
  })
})

// ---------------------------------------------------------------------------
// countLeaves
// ---------------------------------------------------------------------------

test.group('countLeaves', () => {
  test('returns 1 for null', ({ assert }) => {
    assert.equal(countLeaves(null), 1)
  })

  test('returns 1 for undefined', ({ assert }) => {
    assert.equal(countLeaves(undefined), 1)
  })

  test('returns 1 for a string primitive', ({ assert }) => {
    assert.equal(countLeaves('hello'), 1)
  })

  test('returns 1 for a number primitive', ({ assert }) => {
    assert.equal(countLeaves(42), 1)
  })

  test('returns 1 for a boolean primitive', ({ assert }) => {
    assert.equal(countLeaves(true), 1)
  })

  test('returns 1 for an array (treated as leaf)', ({ assert }) => {
    assert.equal(countLeaves([1, 2, 3]), 1)
  })

  test('returns 1 for a redacted value (treated as leaf)', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: '***', value: 'secret' }
    assert.equal(countLeaves(redacted), 1)
  })

  test('returns the number of keys for a flat object', ({ assert }) => {
    assert.equal(countLeaves({ a: 1, b: 2, c: 3 }), 3)
  })

  test('counts leaves in a nested object', ({ assert }) => {
    assert.equal(countLeaves({ a: { b: 1, c: 2 }, d: 3 }), 3)
  })

  test('returns 0 for an empty object', ({ assert }) => {
    assert.equal(countLeaves({}), 0)
  })

  test('counts deeply nested leaves', ({ assert }) => {
    assert.equal(countLeaves({ a: { b: { c: { d: 'deep' } } } }), 1)
  })
})

// ---------------------------------------------------------------------------
// collectTopLevelObjectKeys
// ---------------------------------------------------------------------------

test.group('collectTopLevelObjectKeys', () => {
  test('returns keys whose values are plain objects', ({ assert }) => {
    const config = {
      app: { name: 'test' },
      db: { host: 'localhost' },
      port: 3000,
    }
    const result = collectTopLevelObjectKeys(config)
    assert.deepEqual(result, ['app', 'db'])
  })

  test('excludes keys whose values are arrays', ({ assert }) => {
    const config = {
      items: [1, 2, 3],
      settings: { a: 1 },
    }
    const result = collectTopLevelObjectKeys(config)
    assert.deepEqual(result, ['settings'])
  })

  test('excludes keys whose values are redacted objects', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: '***', value: 'secret' }
    const config = {
      secret: redacted,
      public: { name: 'test' },
    }
    const result = collectTopLevelObjectKeys(config)
    assert.deepEqual(result, ['public'])
  })

  test('excludes keys whose values are primitives', ({ assert }) => {
    const config = {
      name: 'test',
      port: 3000,
      debug: true,
      missing: null,
    }
    const result = collectTopLevelObjectKeys(config)
    assert.deepEqual(result, [])
  })

  test('returns empty array for null', ({ assert }) => {
    assert.deepEqual(collectTopLevelObjectKeys(null), [])
  })

  test('returns empty array for undefined', ({ assert }) => {
    assert.deepEqual(collectTopLevelObjectKeys(undefined), [])
  })

  test('returns empty array for a primitive', ({ assert }) => {
    assert.deepEqual(collectTopLevelObjectKeys('string'), [])
  })

  test('returns empty array for an array', ({ assert }) => {
    assert.deepEqual(collectTopLevelObjectKeys([1, 2]), [])
  })

  test('returns empty array for a redacted value', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: '***', value: 'secret' }
    assert.deepEqual(collectTopLevelObjectKeys(redacted), [])
  })

  test('returns empty array for an empty object', ({ assert }) => {
    assert.deepEqual(collectTopLevelObjectKeys({}), [])
  })
})

// ---------------------------------------------------------------------------
// matchesConfigSearch
// ---------------------------------------------------------------------------

test.group('matchesConfigSearch', () => {
  test('returns true when search term is empty', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('any.key', 'any value', ''))
  })

  test('matches key case-insensitively', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('App.Name', 'value', 'app'))
  })

  test('matches key by substring', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('database.host', 'localhost', 'host'))
  })

  test('matches string value case-insensitively', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('key', 'HelloWorld', 'helloworld'))
  })

  test('matches redacted value display string', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: 'str***ng', value: 'secret' }
    assert.isTrue(matchesConfigSearch('key', redacted, 'str'))
  })

  test('does not throw for null value', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('key', null, 'something'))
  })

  test('does not throw for undefined value', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('key', undefined, 'something'))
  })

  test('returns false when neither key nor value matches', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('app.name', 'myApp', 'database'))
  })

  test('matches number value when stringified', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('port', 3000, '3000'))
  })

  test('matches boolean value when stringified', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('debug', true, 'true'))
  })
})

// ---------------------------------------------------------------------------
// shouldRedact
// ---------------------------------------------------------------------------

test.group('shouldRedact', () => {
  test('redacts "stripe.secretKey" (contains "secret" and "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('stripe.secretKey'))
  })

  test('redacts "database.password"', ({ assert }) => {
    assert.isTrue(shouldRedact('database.password'))
  })

  test('redacts "auth.token"', ({ assert }) => {
    assert.isTrue(shouldRedact('auth.token'))
  })

  test('does not redact "app.name"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.name'))
  })

  test('does not redact "keyboard.layout" (keyboard is one word)', ({ assert }) => {
    assert.isFalse(shouldRedact('keyboard.layout'))
  })

  test('redacts "API_KEY" (uppercase)', ({ assert }) => {
    assert.isTrue(shouldRedact('API_KEY'))
  })

  test('redacts paths containing "encryption"', ({ assert }) => {
    assert.isTrue(shouldRedact('app.encryption'))
  })

  test('redacts paths containing "pwd"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.pwd'))
  })

  test('does not redact "monkey.patch" (monkey is one word)', ({ assert }) => {
    assert.isFalse(shouldRedact('monkey.patch'))
  })

  test('redacts "stripe.publishableKey" (contains "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('stripe.publishableKey'))
  })

  test('redacts "app.key" (exact word "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('app.key'))
  })

  test('redacts "api_key" (snake_case)', ({ assert }) => {
    assert.isTrue(shouldRedact('api_key'))
  })

  test('redacts "auth-token" (kebab-case)', ({ assert }) => {
    assert.isTrue(shouldRedact('auth-token'))
  })

  test('redacts "credential"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.credential'))
  })

  test('redacts "credentials"', ({ assert }) => {
    assert.isTrue(shouldRedact('aws.credentials'))
  })

  test('redacts "private"', ({ assert }) => {
    assert.isTrue(shouldRedact('ssh.private'))
  })

  test('redacts "pass"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.pass'))
  })

  test('does not redact "app.port"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.port'))
  })

  test('does not redact "app.host"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.host'))
  })
})

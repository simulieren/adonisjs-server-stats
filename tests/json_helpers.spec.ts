import { test } from '@japa/runner'
import { safeParseJson, safeParseJsonArray } from '../src/utils/json_helpers.js'

test.group('safeParseJson', () => {
  test('returns null for null input', ({ assert }) => {
    assert.isNull(safeParseJson(null))
  })

  test('returns null for undefined input', ({ assert }) => {
    assert.isNull(safeParseJson(undefined))
  })

  test('returns non-string types as-is', ({ assert }) => {
    assert.equal(safeParseJson(42), 42)
    assert.equal(safeParseJson(true), true)
    assert.equal(safeParseJson(false), false)
    const obj = { a: 1 }
    assert.deepEqual(safeParseJson(obj), obj)
    const arr = [1, 2, 3]
    assert.deepEqual(safeParseJson(arr), arr)
  })

  test('parses a valid JSON string into an object', ({ assert }) => {
    assert.deepEqual(safeParseJson('{"a":1,"b":"hello"}'), { a: 1, b: 'hello' })
  })

  test('parses a valid JSON array string', ({ assert }) => {
    assert.deepEqual(safeParseJson('[1,2,3]'), [1, 2, 3])
  })

  test('returns original string for invalid JSON', ({ assert }) => {
    assert.equal(safeParseJson('not json at all'), 'not json at all')
    assert.equal(safeParseJson('{invalid}'), '{invalid}')
  })

  test('handles empty string (returns original since "" is invalid JSON)', ({ assert }) => {
    assert.equal(safeParseJson(''), '')
  })

  test('parses JSON "null" string to null', ({ assert }) => {
    assert.isNull(safeParseJson('null'))
  })

  test('parses JSON "false" string to false', ({ assert }) => {
    assert.isFalse(safeParseJson('false'))
  })

  test('parses JSON number string to number', ({ assert }) => {
    assert.equal(safeParseJson('123'), 123)
  })

  test('parses JSON "true" string to true', ({ assert }) => {
    assert.isTrue(safeParseJson('true'))
  })
})

test.group('safeParseJsonArray', () => {
  test('parses a valid JSON array string', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray('[1,2,3]'), [1, 2, 3])
  })

  test('parses a JSON array of objects', ({ assert }) => {
    const result = safeParseJsonArray('[{"a":1},{"b":2}]')
    assert.deepEqual(result, [{ a: 1 }, { b: 2 }])
  })

  test('returns empty array when JSON parses to an object', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray('{"a":1}'), [])
  })

  test('returns empty array when JSON parses to a primitive', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray('"hello"'), [])
    assert.deepEqual(safeParseJsonArray('42'), [])
    assert.deepEqual(safeParseJsonArray('true'), [])
    assert.deepEqual(safeParseJsonArray('null'), [])
  })

  test('returns empty array for null input', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray(null), [])
  })

  test('returns empty array for undefined input', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray(undefined), [])
  })

  test('returns empty array for invalid JSON string', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray('not valid json'), [])
  })

  test('passes through an already-parsed array', ({ assert }) => {
    const arr = [1, 2, 3]
    assert.deepEqual(safeParseJsonArray(arr), arr)
  })

  test('returns empty array for a non-string, non-array value', ({ assert }) => {
    assert.deepEqual(safeParseJsonArray(42), [])
    assert.deepEqual(safeParseJsonArray({ a: 1 }), [])
  })
})

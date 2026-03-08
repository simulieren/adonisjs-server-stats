import { test } from '@japa/runner'
import {
  parseTraceSpans,
  parseTraceWarnings,
  resolveTraceField,
  normalizeTraceFields,
} from '../src/core/trace-utils.js'

// ---------------------------------------------------------------------------
// parseTraceSpans
// ---------------------------------------------------------------------------

test.group('parseTraceSpans', () => {
  test('returns empty array for undefined', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(undefined), [])
  })

  test('returns empty array for null', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(null), [])
  })

  test('returns empty array for empty string', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(''), [])
  })

  test('returns empty array for 0 (falsy)', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(0), [])
  })

  test('parses valid JSON string into array', ({ assert }) => {
    const spans = [{ name: 'db', duration: 12 }, { name: 'http', duration: 50 }]
    assert.deepEqual(parseTraceSpans(JSON.stringify(spans)), spans)
  })

  test('returns empty array for invalid JSON string', ({ assert }) => {
    assert.deepEqual(parseTraceSpans('not valid json{'), [])
  })

  test('returns the array as-is when already an array', ({ assert }) => {
    const spans = [{ name: 'db' }]
    const result = parseTraceSpans(spans)
    assert.strictEqual(result, spans)
  })

  test('returns empty array for a non-array truthy value (number)', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(42), [])
  })

  test('returns empty array for a non-array truthy value (object)', ({ assert }) => {
    assert.deepEqual(parseTraceSpans({ not: 'an array' }), [])
  })

  test('returns empty array for boolean true', ({ assert }) => {
    assert.deepEqual(parseTraceSpans(true), [])
  })

  test('parses JSON string of empty array', ({ assert }) => {
    assert.deepEqual(parseTraceSpans('[]'), [])
  })
})

// ---------------------------------------------------------------------------
// parseTraceWarnings
// ---------------------------------------------------------------------------

test.group('parseTraceWarnings', () => {
  test('returns empty array for undefined', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(undefined), [])
  })

  test('returns empty array for null', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(null), [])
  })

  test('returns empty array for empty string', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(''), [])
  })

  test('returns empty array for 0 (falsy)', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(0), [])
  })

  test('parses valid JSON string into array', ({ assert }) => {
    const warnings = ['slow query', 'n+1 detected']
    assert.deepEqual(parseTraceWarnings(JSON.stringify(warnings)), warnings)
  })

  test('returns empty array for invalid JSON string', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings('{broken'), [])
  })

  test('returns the array as-is when already an array', ({ assert }) => {
    const warnings = ['warning1']
    const result = parseTraceWarnings(warnings)
    assert.strictEqual(result, warnings)
  })

  test('returns empty array for a non-array truthy value (number)', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(42), [])
  })

  test('returns empty array for a non-array truthy value (object)', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings({ not: 'an array' }), [])
  })

  test('returns empty array for boolean true', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings(true), [])
  })

  test('parses JSON string of empty array', ({ assert }) => {
    assert.deepEqual(parseTraceWarnings('[]'), [])
  })
})

// ---------------------------------------------------------------------------
// resolveTraceField
// ---------------------------------------------------------------------------

test.group('resolveTraceField', () => {
  test('prefers snake_case key when present', ({ assert }) => {
    assert.equal(resolveTraceField({ status_code: 200, statusCode: 404 }, 'status_code', 'statusCode'), 200)
  })

  test('falls back to camelCase key when snake_case is absent', ({ assert }) => {
    assert.equal(resolveTraceField({ statusCode: 404 }, 'status_code', 'statusCode'), 404)
  })

  test('returns fallback when both keys are missing', ({ assert }) => {
    assert.equal(resolveTraceField({}, 'status_code', 'statusCode'), 0)
  })

  test('returns custom fallback when both keys are missing', ({ assert }) => {
    assert.equal(resolveTraceField({}, 'status_code', 'statusCode', -1), -1)
  })

  test('default fallback is 0', ({ assert }) => {
    assert.equal(resolveTraceField({}, 'a', 'b'), 0)
  })

  test('value 0 is preserved via nullish coalescing', ({ assert }) => {
    // The snake_case value 0 is a valid value and should be returned as-is.
    assert.equal(resolveTraceField({ status_code: 0, statusCode: 200 }, 'status_code', 'statusCode'), 0)
  })

  test('both values being 0 returns 0 (not fallback)', ({ assert }) => {
    // When both keys hold the value 0, it should return 0 (from the snake_case key).
    assert.equal(resolveTraceField({ status_code: 0, statusCode: 0 }, 'status_code', 'statusCode'), 0)
  })

  test('0 with non-zero fallback still returns 0', ({ assert }) => {
    // A legitimate 0 value should not be skipped in favor of the fallback.
    assert.equal(
      resolveTraceField({ status_code: 0, statusCode: 0 }, 'status_code', 'statusCode', 999),
      0
    )
  })

  test('returns snake_case value when camelCase is missing', ({ assert }) => {
    assert.equal(resolveTraceField({ total_duration: 150 }, 'total_duration', 'totalDuration'), 150)
  })
})

// ---------------------------------------------------------------------------
// normalizeTraceFields
// ---------------------------------------------------------------------------

test.group('normalizeTraceFields', () => {
  test('normalizes snake_case input', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/api/users',
      status_code: 200,
      total_duration: 150,
      span_count: 3,
      spans: [],
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result, {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      totalDuration: 150,
      spanCount: 3,
      spans: [],
      warnings: [],
      logs: [],
      httpRequestId: undefined,
    })
  })

  test('normalizes camelCase input', ({ assert }) => {
    const input = {
      method: 'POST',
      url: '/api/items',
      statusCode: 201,
      totalDuration: 80,
      spanCount: 1,
      spans: [{ name: 'db' }],
      warnings: ['slow'],
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result, {
      method: 'POST',
      url: '/api/items',
      statusCode: 201,
      totalDuration: 80,
      spanCount: 1,
      spans: [{ name: 'db' }],
      warnings: ['slow'],
      logs: [],
      httpRequestId: undefined,
    })
  })

  test('normalizes mixed snake_case and camelCase fields', ({ assert }) => {
    const input = {
      method: 'PUT',
      url: '/api/items/1',
      status_code: 200,
      totalDuration: 50,
      span_count: 2,
      spans: [],
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.equal(result.statusCode, 200)
    assert.equal(result.totalDuration, 50)
    assert.equal(result.spanCount, 2)
  })

  test('parses spans from JSON string', ({ assert }) => {
    const spans = [{ name: 'http', duration: 30 }]
    const input = {
      method: 'GET',
      url: '/',
      status_code: 200,
      total_duration: 100,
      span_count: 1,
      spans: JSON.stringify(spans),
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result.spans, spans)
  })

  test('parses warnings from JSON string', ({ assert }) => {
    const warnings = ['n+1 detected', 'slow query']
    const input = {
      method: 'GET',
      url: '/',
      status_code: 200,
      total_duration: 100,
      span_count: 0,
      spans: [],
      warnings: JSON.stringify(warnings),
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result.warnings, warnings)
  })

  test('missing fields get defaults', ({ assert }) => {
    const result = normalizeTraceFields({})
    assert.equal(result.method, '')
    assert.equal(result.url, '')
    assert.equal(result.statusCode, 0)
    assert.equal(result.totalDuration, 0)
    assert.equal(result.spanCount, 0)
    assert.deepEqual(result.spans, [])
    assert.deepEqual(result.warnings, [])
  })

  test('uses duration as fallback for totalDuration', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/test',
      status_code: 200,
      duration: 75,
      span_count: 0,
      spans: [],
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.equal(result.totalDuration, 75)
  })

  test('prefers total_duration over duration', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/test',
      total_duration: 100,
      duration: 75,
      span_count: 0,
      spans: [],
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.equal(result.totalDuration, 100)
  })

  test('prefers totalDuration over duration', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/test',
      totalDuration: 120,
      duration: 75,
      span_count: 0,
      spans: [],
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.equal(result.totalDuration, 120)
  })

  test('handles invalid JSON spans string gracefully', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/',
      spans: 'not json',
      warnings: [],
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result.spans, [])
  })

  test('handles invalid JSON warnings string gracefully', ({ assert }) => {
    const input = {
      method: 'GET',
      url: '/',
      spans: [],
      warnings: '{broken',
    }
    const result = normalizeTraceFields(input)
    assert.deepEqual(result.warnings, [])
  })
})

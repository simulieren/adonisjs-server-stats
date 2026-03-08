import { test } from '@japa/runner'
import { normalizeTraceFields } from '../src/core/trace-utils.js'

// ============================================================================
// normalizeTraceFields with nested trace object
//
// The request detail API response wraps trace data inside a `trace` property.
// Components flatten this before passing to normalizeTraceFields. These tests
// verify that the flattening + normalization pipeline works correctly.
// ============================================================================

test.group('normalizeTraceFields with nested trace', () => {
  test('flattened trace fields are normalized correctly', ({ assert }) => {
    // Simulate the request detail API response where trace is nested
    const apiResponse = {
      method: 'GET',
      url: '/test',
      statusCode: 200,
      duration: 50,
      trace: {
        spans: [{ name: 'middleware', duration: 10, startOffset: 0 }],
        totalDuration: 50,
        warnings: ['slow query'],
        spanCount: 1,
      },
      logs: [{ level: 'info', message: 'test log' }],
    }

    // Flatten like the components do
    const raw = apiResponse as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown>
    const merged = { ...raw, ...trace, logs: raw.logs }
    const normalized = normalizeTraceFields(merged)

    assert.equal(normalized.method, 'GET')
    assert.equal(normalized.url, '/test')
    assert.equal(normalized.statusCode, 200)
    assert.equal(normalized.totalDuration, 50)
    assert.equal(normalized.spanCount, 1)
    assert.lengthOf(normalized.spans, 1)
    assert.lengthOf(normalized.warnings, 1)
    assert.equal(normalized.warnings[0], 'slow query')
    assert.lengthOf(normalized.logs, 1)
  })

  test('works without nested trace (flat trace from traces API)', ({ assert }) => {
    // Flat trace shape (as returned by the traces API)
    const flat = {
      method: 'POST',
      url: '/api',
      status_code: 201,
      total_duration: 100,
      span_count: 3,
      spans: JSON.stringify([{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
      warnings: '[]',
      logs: [],
    }
    const normalized = normalizeTraceFields(flat)
    assert.equal(normalized.method, 'POST')
    assert.equal(normalized.url, '/api')
    assert.equal(normalized.statusCode, 201)
    assert.equal(normalized.totalDuration, 100)
    assert.equal(normalized.spanCount, 3)
    assert.lengthOf(normalized.spans, 3)
    assert.lengthOf(normalized.warnings, 0)
    assert.lengthOf(normalized.logs, 0)
  })

  test('handles null trace gracefully', ({ assert }) => {
    const response = {
      method: 'GET',
      url: '/test',
      statusCode: 200,
      duration: 30,
      trace: null,
      logs: [],
    }
    // When trace is null, don't flatten
    const raw = response as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown> | null
    const merged = trace ? { ...raw, ...trace, logs: raw.logs } : raw
    const normalized = normalizeTraceFields(merged)

    assert.equal(normalized.method, 'GET')
    assert.equal(normalized.url, '/test')
    assert.equal(normalized.statusCode, 200)
    assert.equal(normalized.totalDuration, 30)
    assert.lengthOf(normalized.spans, 0)
    assert.lengthOf(normalized.warnings, 0)
    assert.lengthOf(normalized.logs, 0)
  })

  test('flattened trace preserves logs from outer response', ({ assert }) => {
    // Verify that explicitly setting logs: raw.logs in the merge keeps
    // the logs from the outer response, not any logs from the trace object
    const apiResponse = {
      method: 'GET',
      url: '/api/data',
      statusCode: 200,
      duration: 80,
      trace: {
        spans: [],
        totalDuration: 80,
        warnings: [],
        spanCount: 0,
        // trace might accidentally have a logs field
        logs: [{ level: 'debug', message: 'trace-level log' }],
      },
      logs: [
        { level: 'info', message: 'outer log 1' },
        { level: 'warn', message: 'outer log 2' },
      ],
    }

    const raw = apiResponse as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown>
    // The explicit `logs: raw.logs` at the end should override trace.logs
    const merged = { ...raw, ...trace, logs: raw.logs }
    const normalized = normalizeTraceFields(merged)

    assert.lengthOf(normalized.logs, 2)
    assert.equal((normalized.logs[0] as unknown as Record<string, unknown>).message, 'outer log 1')
    assert.equal((normalized.logs[1] as unknown as Record<string, unknown>).message, 'outer log 2')
  })

  test('flattened trace with JSON string spans from SQLite', ({ assert }) => {
    // Simulate a response where the trace came from SQLite (spans as JSON string)
    // but was nested inside the request detail response
    const apiResponse = {
      method: 'PUT',
      url: '/api/items/42',
      statusCode: 200,
      duration: 120,
      trace: {
        spans: JSON.stringify([
          { name: 'db', duration: 40, startOffset: 0 },
          { name: 'render', duration: 20, startOffset: 50 },
        ]),
        total_duration: 120,
        warnings: JSON.stringify(['slow query']),
        span_count: 2,
      },
      logs: [],
    }

    const raw = apiResponse as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown>
    const merged = { ...raw, ...trace, logs: raw.logs }
    const normalized = normalizeTraceFields(merged)

    assert.equal(normalized.method, 'PUT')
    assert.equal(normalized.statusCode, 200)
    assert.equal(normalized.totalDuration, 120)
    assert.equal(normalized.spanCount, 2)
    assert.lengthOf(normalized.spans, 2)
    assert.lengthOf(normalized.warnings, 1)
    assert.equal(normalized.warnings[0], 'slow query')
  })

  test('handles undefined trace same as null', ({ assert }) => {
    const response = {
      method: 'DELETE',
      url: '/api/items/1',
      statusCode: 204,
      duration: 5,
      logs: [],
    }
    const raw = response as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown> | null | undefined
    const merged = trace ? { ...raw, ...trace, logs: raw.logs } : raw
    const normalized = normalizeTraceFields(merged)

    assert.equal(normalized.method, 'DELETE')
    assert.equal(normalized.statusCode, 204)
    assert.equal(normalized.totalDuration, 5)
    assert.lengthOf(normalized.spans, 0)
  })

  test('httpRequestId is preserved through flattening', ({ assert }) => {
    const apiResponse = {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 45,
      httpRequestId: 'req-abc-123',
      trace: {
        spans: [],
        totalDuration: 45,
        warnings: [],
        spanCount: 0,
      },
      logs: [],
    }

    const raw = apiResponse as Record<string, unknown>
    const trace = raw.trace as Record<string, unknown>
    const merged = { ...raw, ...trace, logs: raw.logs }
    const normalized = normalizeTraceFields(merged)

    assert.equal(normalized.httpRequestId, 'req-abc-123')
  })
})

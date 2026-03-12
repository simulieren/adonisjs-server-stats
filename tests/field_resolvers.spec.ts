import { test } from '@japa/runner'
import {
  resolveField,
  resolveTimestamp,
  resolveJobTimestamp,
  resolveStatusCode,
  resolveDuration,
  resolveSpanCount,
  resolveWarningCount,
  resolveFromAddr,
  resolveToAddr,
  resolveCcAddr,
  resolveAttachmentCount,
  resolveEventName,
  resolveSqlMethod,
  resolveNormalizedSql,
  resolveMetric,
} from '../src/core/field-resolvers.js'

test.group('resolveField', () => {
  test('returns first matching key', ({ assert }) => {
    const row = { a: 1, b: 2 }
    assert.equal(resolveField(row, 'a', 'b'), 1)
  })

  test('skips null/undefined keys', ({ assert }) => {
    const row = { a: null, b: undefined, c: 'found' }
    assert.equal(resolveField(row, 'a', 'b', 'c'), 'found')
  })

  test('returns undefined when no key matches', ({ assert }) => {
    assert.isUndefined(resolveField({}, 'x', 'y'))
  })

  test('returns falsy values like 0 and empty string', ({ assert }) => {
    assert.equal(resolveField({ a: 0 }, 'a'), 0)
    assert.equal(resolveField({ a: '' }, 'a'), '')
  })
})

test.group('resolveTimestamp', () => {
  test('resolves camelCase createdAt', ({ assert }) => {
    assert.equal(resolveTimestamp({ createdAt: '2025-01-01' }), '2025-01-01')
  })

  test('resolves snake_case created_at', ({ assert }) => {
    assert.equal(resolveTimestamp({ created_at: '2025-01-01' }), '2025-01-01')
  })

  test('resolves timestamp field', ({ assert }) => {
    assert.equal(resolveTimestamp({ timestamp: 1234567890 }), 1234567890)
  })

  test('prefers createdAt over created_at', ({ assert }) => {
    assert.equal(resolveTimestamp({ createdAt: 'camel', created_at: 'snake' }), 'camel')
  })

  test('returns undefined when no matching field', ({ assert }) => {
    assert.isUndefined(resolveTimestamp({ other: 'value' }))
  })
})

test.group('resolveJobTimestamp', () => {
  test('prefers timestamp over createdAt', ({ assert }) => {
    assert.equal(resolveJobTimestamp({ timestamp: 100, createdAt: 200 }), 100)
  })

  test('falls back to processedAt', ({ assert }) => {
    assert.equal(resolveJobTimestamp({ processedAt: 300 }), 300)
  })
})

test.group('resolveStatusCode', () => {
  test('resolves camelCase statusCode', ({ assert }) => {
    assert.equal(resolveStatusCode({ statusCode: 200 }), 200)
  })

  test('resolves snake_case status_code', ({ assert }) => {
    assert.equal(resolveStatusCode({ status_code: 404 }), 404)
  })

  test('returns undefined when missing', ({ assert }) => {
    assert.isUndefined(resolveStatusCode({}))
  })
})

test.group('resolveDuration', () => {
  test('resolves total_duration', ({ assert }) => {
    assert.equal(resolveDuration({ total_duration: 150 }), 150)
  })

  test('resolves totalDuration', ({ assert }) => {
    assert.equal(resolveDuration({ totalDuration: 200 }), 200)
  })

  test('resolves duration', ({ assert }) => {
    assert.equal(resolveDuration({ duration: 50 }), 50)
  })

  test('defaults to 0', ({ assert }) => {
    assert.equal(resolveDuration({}), 0)
  })
})

test.group('resolveSpanCount', () => {
  test('resolves span_count', ({ assert }) => {
    assert.equal(resolveSpanCount({ span_count: 5 }), 5)
  })

  test('resolves spanCount', ({ assert }) => {
    assert.equal(resolveSpanCount({ spanCount: 3 }), 3)
  })

  test('defaults to 0', ({ assert }) => {
    assert.equal(resolveSpanCount({}), 0)
  })
})

test.group('resolveWarningCount', () => {
  test('resolves warning_count', ({ assert }) => {
    assert.equal(resolveWarningCount({ warning_count: 2 }), 2)
  })

  test('resolves warningCount', ({ assert }) => {
    assert.equal(resolveWarningCount({ warningCount: 1 }), 1)
  })

  test('defaults to 0', ({ assert }) => {
    assert.equal(resolveWarningCount({}), 0)
  })
})

test.group('resolveFromAddr / resolveToAddr / resolveCcAddr', () => {
  test('resolves from_addr', ({ assert }) => {
    assert.equal(resolveFromAddr({ from_addr: 'a@b.com' }), 'a@b.com')
  })

  test('resolves from field', ({ assert }) => {
    assert.equal(resolveFromAddr({ from: 'x@y.com' }), 'x@y.com')
  })

  test('defaults to empty string', ({ assert }) => {
    assert.equal(resolveFromAddr({}), '')
  })

  test('resolves to_addr', ({ assert }) => {
    assert.equal(resolveToAddr({ to_addr: 'c@d.com' }), 'c@d.com')
  })

  test('resolves to field', ({ assert }) => {
    assert.equal(resolveToAddr({ to: 'e@f.com' }), 'e@f.com')
  })

  test('resolves cc', ({ assert }) => {
    assert.equal(resolveCcAddr({ cc: 'g@h.com' }), 'g@h.com')
  })

  test('resolves cc_addr', ({ assert }) => {
    assert.equal(resolveCcAddr({ cc_addr: 'i@j.com' }), 'i@j.com')
  })
})

test.group('resolveAttachmentCount', () => {
  test('resolves attachment_count', ({ assert }) => {
    assert.equal(resolveAttachmentCount({ attachment_count: 3 }), 3)
  })

  test('resolves attachmentCount', ({ assert }) => {
    assert.equal(resolveAttachmentCount({ attachmentCount: 1 }), 1)
  })

  test('defaults to 0', ({ assert }) => {
    assert.equal(resolveAttachmentCount({}), 0)
  })
})

test.group('resolveEventName', () => {
  test('resolves event_name', ({ assert }) => {
    assert.equal(resolveEventName({ event_name: 'user:login' }), 'user:login')
  })

  test('resolves eventName', ({ assert }) => {
    assert.equal(resolveEventName({ eventName: 'user:logout' }), 'user:logout')
  })

  test('resolves event', ({ assert }) => {
    assert.equal(resolveEventName({ event: 'click' }), 'click')
  })

  test('defaults to empty string', ({ assert }) => {
    assert.equal(resolveEventName({}), '')
  })
})

test.group('resolveSqlMethod', () => {
  test('resolves method', ({ assert }) => {
    assert.equal(resolveSqlMethod({ method: 'SELECT' }), 'SELECT')
  })

  test('resolves sql_method', ({ assert }) => {
    assert.equal(resolveSqlMethod({ sql_method: 'INSERT' }), 'INSERT')
  })

  test('defaults to empty string', ({ assert }) => {
    assert.equal(resolveSqlMethod({}), '')
  })
})

test.group('resolveNormalizedSql', () => {
  test('resolves sqlNormalized', ({ assert }) => {
    assert.equal(resolveNormalizedSql({ sqlNormalized: 'SELECT * FROM ?' }), 'SELECT * FROM ?')
  })

  test('resolves normalizedSql', ({ assert }) => {
    assert.equal(resolveNormalizedSql({ normalizedSql: 'INSERT INTO ?' }), 'INSERT INTO ?')
  })

  test('resolves sql_normalized', ({ assert }) => {
    assert.equal(resolveNormalizedSql({ sql_normalized: 'UPDATE ?' }), 'UPDATE ?')
  })

  test('resolves sql as last fallback', ({ assert }) => {
    assert.equal(resolveNormalizedSql({ sql: 'DELETE FROM users' }), 'DELETE FROM users')
  })

  test('defaults to empty string', ({ assert }) => {
    assert.equal(resolveNormalizedSql({}), '')
  })
})

test.group('resolveMetric', () => {
  test('prefers camelCase key', ({ assert }) => {
    assert.equal(resolveMetric({ totalRequests: 42, total_requests: 10 }, 'totalRequests', 'total_requests'), 42)
  })

  test('falls back to snake_case key', ({ assert }) => {
    assert.equal(resolveMetric({ total_requests: 10 }, 'totalRequests', 'total_requests'), 10)
  })

  test('returns 0 when neither key exists', ({ assert }) => {
    assert.equal(resolveMetric({}, 'totalRequests', 'total_requests'), 0)
  })

  test('converts string values to numbers', ({ assert }) => {
    assert.equal(resolveMetric({ total_requests: '15' }, 'totalRequests', 'total_requests'), 15)
  })
})

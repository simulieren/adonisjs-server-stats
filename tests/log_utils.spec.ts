import { test } from '@japa/runner'
import {
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  filterLogsByLevel,
} from '../src/core/log-utils.js'

// ---------------------------------------------------------------------------
// resolveLogLevel
// ---------------------------------------------------------------------------

test.group('resolveLogLevel', () => {
  test('prefers levelName when present', ({ assert }) => {
    assert.equal(resolveLogLevel({ levelName: 'WARN', level_name: 'error', level: 'debug' }), 'warn')
  })

  test('falls back to level_name when levelName is absent', ({ assert }) => {
    assert.equal(resolveLogLevel({ level_name: 'ERROR', level: 'debug' }), 'error')
  })

  test('falls back to level when it is a string', ({ assert }) => {
    assert.equal(resolveLogLevel({ level: 'debug' }), 'debug')
  })

  test('skips numeric level and defaults to info', ({ assert }) => {
    assert.equal(resolveLogLevel({ level: 30 }), 'info')
  })

  test('defaults to info when no level fields are present', ({ assert }) => {
    assert.equal(resolveLogLevel({}), 'info')
  })

  test('result is lowercased', ({ assert }) => {
    assert.equal(resolveLogLevel({ levelName: 'DEBUG' }), 'debug')
  })

  test('lowercases level_name', ({ assert }) => {
    assert.equal(resolveLogLevel({ level_name: 'FATAL' }), 'fatal')
  })

  test('lowercases string level field', ({ assert }) => {
    assert.equal(resolveLogLevel({ level: 'TRACE' }), 'trace')
  })

  test('skips empty levelName and falls back', ({ assert }) => {
    assert.equal(resolveLogLevel({ levelName: '', level_name: 'warn' }), 'warn')
  })

  test('skips empty levelName and empty level_name, falls back to level', ({ assert }) => {
    assert.equal(resolveLogLevel({ levelName: '', level_name: '', level: 'error' }), 'error')
  })

  test('skips all empty strings and defaults to info', ({ assert }) => {
    assert.equal(resolveLogLevel({ levelName: '', level_name: '', level: '' }), 'info')
  })
})

// ---------------------------------------------------------------------------
// resolveLogMessage
// ---------------------------------------------------------------------------

test.group('resolveLogMessage', () => {
  test('prefers msg when present', ({ assert }) => {
    assert.equal(resolveLogMessage({ msg: 'hello', message: 'world' }), 'hello')
  })

  test('falls back to message when msg is absent', ({ assert }) => {
    assert.equal(resolveLogMessage({ message: 'fallback' }), 'fallback')
  })

  test('falls back to JSON.stringify when neither msg nor message is present', ({ assert }) => {
    const entry = { level: 'info', foo: 42 }
    assert.equal(resolveLogMessage(entry), JSON.stringify(entry))
  })

  test('falls back to JSON.stringify when msg is empty string', ({ assert }) => {
    const entry = { msg: '', message: '' }
    assert.equal(resolveLogMessage(entry), JSON.stringify(entry))
  })

  test('returns msg even if message is also present', ({ assert }) => {
    assert.equal(resolveLogMessage({ msg: 'primary', message: 'secondary' }), 'primary')
  })

  test('handles entry with only unrelated fields', ({ assert }) => {
    const entry = { a: 1, b: 2 }
    assert.equal(resolveLogMessage(entry), JSON.stringify(entry))
  })
})

// ---------------------------------------------------------------------------
// resolveLogTimestamp
// ---------------------------------------------------------------------------

test.group('resolveLogTimestamp', () => {
  test('prefers createdAt when present', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ createdAt: 1000, created_at: 2000, time: 3000 }), 1000)
  })

  test('falls back to created_at when createdAt is absent', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ created_at: 2000, time: 3000 }), 2000)
  })

  test('falls back to time when createdAt and created_at are absent', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ time: 3000, timestamp: 4000 }), 3000)
  })

  test('falls back to timestamp when others are absent', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ timestamp: 4000 }), 4000)
  })

  test('returns 0 when no timestamp fields are present', ({ assert }) => {
    assert.equal(resolveLogTimestamp({}), 0)
  })

  test('accepts string timestamps for createdAt', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ createdAt: '2021-01-01T00:00:00Z' }), '2021-01-01T00:00:00Z')
  })

  test('accepts string timestamps for created_at', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ created_at: '2021-06-15' }), '2021-06-15')
  })

  test('returns 0 when all timestamp fields are falsy (0)', ({ assert }) => {
    assert.equal(resolveLogTimestamp({ createdAt: 0, created_at: 0, time: 0, timestamp: 0 }), 0)
  })
})

// ---------------------------------------------------------------------------
// resolveLogRequestId
// ---------------------------------------------------------------------------

test.group('resolveLogRequestId', () => {
  test('returns top-level requestId', ({ assert }) => {
    assert.equal(resolveLogRequestId({ requestId: 'abc-123' }), 'abc-123')
  })

  test('returns top-level request_id', ({ assert }) => {
    assert.equal(resolveLogRequestId({ request_id: 'def-456' }), 'def-456')
  })

  test('returns top-level x-request-id', ({ assert }) => {
    assert.equal(resolveLogRequestId({ 'x-request-id': 'ghi-789' }), 'ghi-789')
  })

  test('returns nested data.requestId', ({ assert }) => {
    assert.equal(resolveLogRequestId({ data: { requestId: 'nested-1' } }), 'nested-1')
  })

  test('returns nested data.request_id', ({ assert }) => {
    assert.equal(resolveLogRequestId({ data: { request_id: 'nested-2' } }), 'nested-2')
  })

  test('returns nested data.x-request-id', ({ assert }) => {
    assert.equal(resolveLogRequestId({ data: { 'x-request-id': 'nested-3' } }), 'nested-3')
  })

  test('prefers top-level requestId over nested', ({ assert }) => {
    assert.equal(
      resolveLogRequestId({ requestId: 'top', data: { requestId: 'nested' } }),
      'top'
    )
  })

  test('no data property does not throw', ({ assert }) => {
    assert.equal(resolveLogRequestId({ msg: 'hello' }), '')
  })

  test('returns empty string when not found', ({ assert }) => {
    assert.equal(resolveLogRequestId({}), '')
  })

  test('returns empty string when data exists but has no request id fields', ({ assert }) => {
    assert.equal(resolveLogRequestId({ data: { foo: 'bar' } }), '')
  })

  test('falls back from top-level to nested when top-level fields are empty', ({ assert }) => {
    assert.equal(
      resolveLogRequestId({ requestId: '', request_id: '', 'x-request-id': '', data: { requestId: 'found' } }),
      'found'
    )
  })
})

// ---------------------------------------------------------------------------
// getLogLevelCssClass
// ---------------------------------------------------------------------------

test.group('getLogLevelCssClass', () => {
  test('returns -error for error level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('error'), 'ss-dbg-log-level-error')
  })

  test('returns -error for fatal level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('fatal'), 'ss-dbg-log-level-error')
  })

  test('returns -warn for warn level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('warn'), 'ss-dbg-log-level-warn')
  })

  test('returns -info for info level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('info'), 'ss-dbg-log-level-info')
  })

  test('returns -debug for debug level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('debug'), 'ss-dbg-log-level-debug')
  })

  test('returns -trace for trace level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('trace'), 'ss-dbg-log-level-trace')
  })

  test('returns -info for unknown level', ({ assert }) => {
    assert.equal(getLogLevelCssClass('verbose'), 'ss-dbg-log-level-info')
  })

  test('returns -info for empty string level', ({ assert }) => {
    assert.equal(getLogLevelCssClass(''), 'ss-dbg-log-level-info')
  })

  test('supports custom prefix', ({ assert }) => {
    assert.equal(getLogLevelCssClass('error', 'custom'), 'custom-error')
  })

  test('supports custom prefix for warn', ({ assert }) => {
    assert.equal(getLogLevelCssClass('warn', 'my-prefix'), 'my-prefix-warn')
  })

  test('supports custom prefix for unknown level (defaults to -info)', ({ assert }) => {
    assert.equal(getLogLevelCssClass('unknown', 'pfx'), 'pfx-info')
  })
})

// ---------------------------------------------------------------------------
// filterLogsByLevel
// ---------------------------------------------------------------------------

test.group('filterLogsByLevel', () => {
  const logs = [
    { levelName: 'error', msg: 'err1' },
    { levelName: 'warn', msg: 'warn1' },
    { levelName: 'info', msg: 'info1' },
    { levelName: 'debug', msg: 'debug1' },
    { levelName: 'fatal', msg: 'fatal1' },
    { levelName: 'info', msg: 'info2' },
  ]

  test('returns original array when level is "all"', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'all')
    assert.strictEqual(result, logs)
  })

  test('error filter includes fatal entries', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'error')
    assert.lengthOf(result, 2)
    assert.equal(result[0].msg, 'err1')
    assert.equal(result[1].msg, 'fatal1')
  })

  test('warn filter returns only warn entries', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'warn')
    assert.lengthOf(result, 1)
    assert.equal(result[0].msg, 'warn1')
  })

  test('info filter returns only info entries', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'info')
    assert.lengthOf(result, 2)
    assert.equal(result[0].msg, 'info1')
    assert.equal(result[1].msg, 'info2')
  })

  test('debug filter returns only debug entries', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'debug')
    assert.lengthOf(result, 1)
    assert.equal(result[0].msg, 'debug1')
  })

  test('returns empty array when no entries match the level', ({ assert }) => {
    const result = filterLogsByLevel(logs, 'trace')
    assert.lengthOf(result, 0)
  })

  test('handles empty array input', ({ assert }) => {
    const result = filterLogsByLevel([], 'error')
    assert.lengthOf(result, 0)
  })

  test('resolves level from various field names before filtering', ({ assert }) => {
    const mixed = [
      { level_name: 'error', msg: 'a' },
      { level: 'error', msg: 'b' },
      { levelName: 'info', msg: 'c' },
    ]
    const result = filterLogsByLevel(mixed, 'error')
    assert.lengthOf(result, 2)
  })
})

import { test } from '@japa/runner'
import {
  formatUptime,
  formatBytes,
  formatMb,
  formatCount,
  formatDuration,
  formatTime,
  timeAgo,
  formatStatNum,
  getThresholdColor,
  getThresholdColorInverse,
  getRatioColor,
  statusColor,
  durationSeverity,
  shortReqId,
  compactPreview,
  formatTtl,
  formatCacheSize,
} from '../src/core/formatters.js'

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------

test.group('formatUptime', () => {
  test('returns "-" for undefined', ({ assert }) => {
    assert.equal(formatUptime(undefined), '-')
  })

  test('returns "-" for null', ({ assert }) => {
    assert.equal(formatUptime(null), '-')
  })

  test('returns "0s" for 0', ({ assert }) => {
    assert.equal(formatUptime(0), '0s')
  })

  test('formats seconds only', ({ assert }) => {
    assert.equal(formatUptime(45), '45s')
  })

  test('formats minutes and seconds', ({ assert }) => {
    assert.equal(formatUptime(150), '2m 30s')
  })

  test('formats hours and minutes', ({ assert }) => {
    assert.equal(formatUptime(3720), '1h 2m')
  })

  test('formats days and hours', ({ assert }) => {
    assert.equal(formatUptime(90000), '1d 1h')
  })

  test('formats exactly 1 minute as "1m 0s"', ({ assert }) => {
    assert.equal(formatUptime(60), '1m 0s')
  })

  test('formats exactly 1 hour as "1h 0m"', ({ assert }) => {
    assert.equal(formatUptime(3600), '1h 0m')
  })

  test('formats exactly 1 day as "1d 0h"', ({ assert }) => {
    assert.equal(formatUptime(86400), '1d 0h')
  })

  test('formats multiple days with hours', ({ assert }) => {
    assert.equal(formatUptime(180000), '2d 2h')
  })
})

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

test.group('formatBytes', () => {
  test('formats bytes in the MB range', ({ assert }) => {
    const result = formatBytes(128 * 1024 * 1024) // 128 MB
    assert.equal(result, '128M')
  })

  test('formats bytes in the GB range', ({ assert }) => {
    const result = formatBytes(2 * 1024 * 1024 * 1024) // 2 GB
    assert.equal(result, '2.0G')
  })

  test('formats bytes at the boundary (exactly 1024 MB = 1 GB)', ({ assert }) => {
    const result = formatBytes(1024 * 1024 * 1024)
    assert.equal(result, '1.0G')
  })

  test('formats small byte counts as MB', ({ assert }) => {
    const result = formatBytes(1024 * 1024) // 1 MB
    assert.equal(result, '1M')
  })

  test('formats bytes just below the GB boundary', ({ assert }) => {
    const result = formatBytes(1023 * 1024 * 1024) // 1023 MB
    assert.equal(result, '1023M')
  })

  test('formats fractional GB values', ({ assert }) => {
    const result = formatBytes(1.5 * 1024 * 1024 * 1024)
    assert.equal(result, '1.5G')
  })
})

// ---------------------------------------------------------------------------
// formatMb
// ---------------------------------------------------------------------------

test.group('formatMb', () => {
  test('formats value under 1024 as MB', ({ assert }) => {
    assert.equal(formatMb(512), '512.0M')
  })

  test('formats value at or over 1024 as GB', ({ assert }) => {
    assert.equal(formatMb(1024), '1.0G')
  })

  test('formats fractional GB', ({ assert }) => {
    assert.equal(formatMb(2048), '2.0G')
  })

  test('formats fractional MB', ({ assert }) => {
    assert.equal(formatMb(256.7), '256.7M')
  })

  test('formats value just below GB boundary', ({ assert }) => {
    assert.equal(formatMb(1023.9), '1023.9M')
  })
})

// ---------------------------------------------------------------------------
// formatCount
// ---------------------------------------------------------------------------

test.group('formatCount', () => {
  test('formats number under 1000 as-is', ({ assert }) => {
    assert.equal(formatCount(42), '42')
  })

  test('formats thousands with K suffix', ({ assert }) => {
    assert.equal(formatCount(1200), '1.2K')
  })

  test('formats millions with M suffix', ({ assert }) => {
    assert.equal(formatCount(3400000), '3.4M')
  })

  test('formats exactly 1000 as K', ({ assert }) => {
    assert.equal(formatCount(1000), '1.0K')
  })

  test('formats exactly 1_000_000 as M', ({ assert }) => {
    assert.equal(formatCount(1000000), '1.0M')
  })

  test('formats 0 as "0"', ({ assert }) => {
    assert.equal(formatCount(0), '0')
  })

  test('formats 999 without suffix', ({ assert }) => {
    assert.equal(formatCount(999), '999')
  })
})

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test.group('formatDuration', () => {
  test('formats >= 1000ms as seconds with 2 decimals', ({ assert }) => {
    assert.equal(formatDuration(1234), '1.23s')
  })

  test('formats exactly 1000ms as "1.00s"', ({ assert }) => {
    assert.equal(formatDuration(1000), '1.00s')
  })

  test('formats 1-999ms as integer milliseconds', ({ assert }) => {
    assert.equal(formatDuration(12), '12ms')
  })

  test('formats exactly 1ms', ({ assert }) => {
    assert.equal(formatDuration(1), '1ms')
  })

  test('formats sub-millisecond values with 2 decimals', ({ assert }) => {
    assert.equal(formatDuration(0.45), '0.45ms')
  })

  test('formats 999ms as "999ms"', ({ assert }) => {
    assert.equal(formatDuration(999), '999ms')
  })

  test('formats very small sub-ms value', ({ assert }) => {
    assert.equal(formatDuration(0.01), '0.01ms')
  })
})

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

test.group('formatTime', () => {
  test('returns "-" for falsy value (0)', ({ assert }) => {
    assert.equal(formatTime(0), '-')
  })

  test('returns "-" for empty string', ({ assert }) => {
    assert.equal(formatTime(''), '-')
  })

  test('formats a valid Unix timestamp', ({ assert }) => {
    const result = formatTime(1609459200000) // 2021-01-01T00:00:00.000Z
    // The result should match HH:MM:SS.mmm format
    assert.match(result, /^\d{2}:\d{2}:\d{2}\.\d{3}$/)
  })

  test('formats a valid ISO string', ({ assert }) => {
    const result = formatTime('2021-06-15T14:30:45.123Z')
    assert.match(result, /^\d{2}:\d{2}:\d{2}\.\d{3}$/)
  })

  test('returns "-" for an invalid date string', ({ assert }) => {
    assert.equal(formatTime('not-a-date'), '-')
  })

  test('includes milliseconds in output', ({ assert }) => {
    // Create a known timestamp
    const d = new Date(2021, 0, 1, 12, 30, 45, 123)
    const result = formatTime(d.getTime())
    assert.isTrue(result.endsWith('.123'))
  })

  test('pads milliseconds with leading zeros', ({ assert }) => {
    const d = new Date(2021, 0, 1, 12, 30, 45, 5)
    const result = formatTime(d.getTime())
    assert.isTrue(result.endsWith('.005'))
  })
})

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------

test.group('timeAgo', () => {
  test('returns "-" for falsy value (0)', ({ assert }) => {
    assert.equal(timeAgo(0), '-')
  })

  test('returns "-" for empty string', ({ assert }) => {
    assert.equal(timeAgo(''), '-')
  })

  test('returns seconds ago for recent timestamps', ({ assert }) => {
    const ts = Date.now() - 30 * 1000 // 30 seconds ago
    assert.equal(timeAgo(ts), '30s ago')
  })

  test('returns minutes ago', ({ assert }) => {
    const ts = Date.now() - 5 * 60 * 1000 // 5 minutes ago
    assert.equal(timeAgo(ts), '5m ago')
  })

  test('returns hours ago', ({ assert }) => {
    const ts = Date.now() - 3 * 3600 * 1000 // 3 hours ago
    assert.equal(timeAgo(ts), '3h ago')
  })

  test('returns days ago', ({ assert }) => {
    const ts = Date.now() - 2 * 86400 * 1000 // 2 days ago
    assert.equal(timeAgo(ts), '2d ago')
  })

  test('returns "just now" for future timestamps', ({ assert }) => {
    const ts = Date.now() + 60 * 1000 // 1 minute in the future
    assert.equal(timeAgo(ts), 'just now')
  })

  test('handles ISO string input', ({ assert }) => {
    const ts = new Date(Date.now() - 120 * 1000).toISOString() // 2 minutes ago
    assert.equal(timeAgo(ts), '2m ago')
  })
})

// ---------------------------------------------------------------------------
// formatStatNum
// ---------------------------------------------------------------------------

test.group('formatStatNum', () => {
  test('formats percentage unit', ({ assert }) => {
    assert.equal(formatStatNum(85.456, '%'), '85.5%')
  })

  test('formats ms unit as integer', ({ assert }) => {
    assert.equal(formatStatNum(123.7, 'ms'), '124ms')
  })

  test('formats MB unit as M with 1 decimal', ({ assert }) => {
    assert.equal(formatStatNum(512.34, 'MB'), '512.3M')
  })

  test('formats bytes unit using formatBytes', ({ assert }) => {
    const result = formatStatNum(128 * 1024 * 1024, 'bytes')
    assert.equal(result, '128M')
  })

  test('formats /s unit with 1 decimal', ({ assert }) => {
    assert.equal(formatStatNum(42.789, '/s'), '42.8')
  })

  test('formats /m unit with 1 decimal', ({ assert }) => {
    assert.equal(formatStatNum(15.123, '/m'), '15.1')
  })

  test('formats unknown unit with 1 decimal (default)', ({ assert }) => {
    assert.equal(formatStatNum(7.89, 'unknown'), '7.9')
  })
})

// ---------------------------------------------------------------------------
// getThresholdColor
// ---------------------------------------------------------------------------

test.group('getThresholdColor', () => {
  test('returns green when value is below warn threshold', ({ assert }) => {
    assert.equal(getThresholdColor(30, 50, 80), 'green')
  })

  test('returns amber when value is above warn but below crit', ({ assert }) => {
    assert.equal(getThresholdColor(60, 50, 80), 'amber')
  })

  test('returns red when value is above crit threshold', ({ assert }) => {
    assert.equal(getThresholdColor(90, 50, 80), 'red')
  })

  test('returns green when value equals warn threshold (not above)', ({ assert }) => {
    assert.equal(getThresholdColor(50, 50, 80), 'green')
  })

  test('returns amber when value equals crit threshold (not above)', ({ assert }) => {
    assert.equal(getThresholdColor(80, 50, 80), 'amber')
  })

  test('returns red when value is just above crit threshold', ({ assert }) => {
    assert.equal(getThresholdColor(80.1, 50, 80), 'red')
  })
})

// ---------------------------------------------------------------------------
// getThresholdColorInverse
// ---------------------------------------------------------------------------

test.group('getThresholdColorInverse', () => {
  test('returns green when value is above warn threshold', ({ assert }) => {
    assert.equal(getThresholdColorInverse(80, 50, 30), 'green')
  })

  test('returns amber when value is below warn but above crit', ({ assert }) => {
    assert.equal(getThresholdColorInverse(40, 50, 30), 'amber')
  })

  test('returns red when value is below crit threshold', ({ assert }) => {
    assert.equal(getThresholdColorInverse(20, 50, 30), 'red')
  })

  test('returns green when value equals warn threshold (not below)', ({ assert }) => {
    assert.equal(getThresholdColorInverse(50, 50, 30), 'green')
  })

  test('returns amber when value equals crit threshold (not below)', ({ assert }) => {
    assert.equal(getThresholdColorInverse(30, 50, 30), 'amber')
  })

  test('returns red when value is just below crit threshold', ({ assert }) => {
    assert.equal(getThresholdColorInverse(29.9, 50, 30), 'red')
  })
})

// ---------------------------------------------------------------------------
// getRatioColor
// ---------------------------------------------------------------------------

test.group('getRatioColor', () => {
  test('returns green when max is 0', ({ assert }) => {
    assert.equal(getRatioColor(10, 0), 'green')
  })

  test('returns green when ratio is at or below 0.5', ({ assert }) => {
    assert.equal(getRatioColor(5, 10), 'green')
  })

  test('returns amber when ratio is above 0.5 but at or below 0.8', ({ assert }) => {
    assert.equal(getRatioColor(6, 10), 'amber')
  })

  test('returns red when ratio is above 0.8', ({ assert }) => {
    assert.equal(getRatioColor(9, 10), 'red')
  })

  test('returns green when ratio is exactly 0.5', ({ assert }) => {
    assert.equal(getRatioColor(50, 100), 'green')
  })

  test('returns amber when ratio is exactly 0.8', ({ assert }) => {
    assert.equal(getRatioColor(80, 100), 'amber')
  })

  test('returns amber when ratio is just above 0.5', ({ assert }) => {
    assert.equal(getRatioColor(51, 100), 'amber')
  })

  test('returns red when ratio is just above 0.8', ({ assert }) => {
    assert.equal(getRatioColor(81, 100), 'red')
  })
})

// ---------------------------------------------------------------------------
// statusColor
// ---------------------------------------------------------------------------

test.group('statusColor', () => {
  test('returns green for 200', ({ assert }) => {
    assert.equal(statusColor(200), 'green')
  })

  test('returns green for 201', ({ assert }) => {
    assert.equal(statusColor(201), 'green')
  })

  test('returns green for 301 (redirect)', ({ assert }) => {
    assert.equal(statusColor(301), 'green')
  })

  test('returns green for 304', ({ assert }) => {
    assert.equal(statusColor(304), 'green')
  })

  test('returns amber for 400', ({ assert }) => {
    assert.equal(statusColor(400), 'amber')
  })

  test('returns amber for 404', ({ assert }) => {
    assert.equal(statusColor(404), 'amber')
  })

  test('returns amber for 499', ({ assert }) => {
    assert.equal(statusColor(499), 'amber')
  })

  test('returns red for 500', ({ assert }) => {
    assert.equal(statusColor(500), 'red')
  })

  test('returns red for 503', ({ assert }) => {
    assert.equal(statusColor(503), 'red')
  })

  test('returns green for informational 100', ({ assert }) => {
    assert.equal(statusColor(100), 'green')
  })
})

// ---------------------------------------------------------------------------
// durationSeverity
// ---------------------------------------------------------------------------

test.group('durationSeverity', () => {
  test('returns "normal" for durations at or below 100ms', ({ assert }) => {
    assert.equal(durationSeverity(100), 'normal')
  })

  test('returns "normal" for 0ms', ({ assert }) => {
    assert.equal(durationSeverity(0), 'normal')
  })

  test('returns "slow" for durations above 100ms but at or below 500ms', ({ assert }) => {
    assert.equal(durationSeverity(101), 'slow')
  })

  test('returns "slow" for 500ms (boundary)', ({ assert }) => {
    assert.equal(durationSeverity(500), 'slow')
  })

  test('returns "very-slow" for durations above 500ms', ({ assert }) => {
    assert.equal(durationSeverity(501), 'very-slow')
  })

  test('returns "very-slow" for very large durations', ({ assert }) => {
    assert.equal(durationSeverity(10000), 'very-slow')
  })

  test('returns "slow" for 250ms', ({ assert }) => {
    assert.equal(durationSeverity(250), 'slow')
  })
})

// ---------------------------------------------------------------------------
// shortReqId
// ---------------------------------------------------------------------------

test.group('shortReqId', () => {
  test('returns "--" for empty string', ({ assert }) => {
    assert.equal(shortReqId(''), '--')
  })

  test('returns the ID as-is when 8 characters or shorter', ({ assert }) => {
    assert.equal(shortReqId('abcd1234'), 'abcd1234')
  })

  test('returns short ID as-is', ({ assert }) => {
    assert.equal(shortReqId('abc'), 'abc')
  })

  test('truncates long IDs to 8 chars with ellipsis', ({ assert }) => {
    assert.equal(shortReqId('abcdefghijklmnop'), 'abcdefgh\u2026')
  })

  test('handles exactly 9 character ID (truncated)', ({ assert }) => {
    assert.equal(shortReqId('123456789'), '12345678\u2026')
  })

  test('handles exactly 8 character ID (not truncated)', ({ assert }) => {
    assert.equal(shortReqId('12345678'), '12345678')
  })
})

// ---------------------------------------------------------------------------
// compactPreview
// ---------------------------------------------------------------------------

test.group('compactPreview', () => {
  test('returns "null" for null', ({ assert }) => {
    assert.equal(compactPreview(null), 'null')
  })

  test('returns "-" for undefined', ({ assert }) => {
    assert.equal(compactPreview(undefined), '-')
  })

  test('wraps short strings in quotes', ({ assert }) => {
    assert.equal(compactPreview('hello'), '"hello"')
  })

  test('truncates long strings at 40 chars', ({ assert }) => {
    const long = 'a'.repeat(50)
    const result = compactPreview(long)
    assert.equal(result, '"' + 'a'.repeat(40) + '..."')
  })

  test('does not truncate strings at exactly 40 chars', ({ assert }) => {
    const exact = 'a'.repeat(40)
    assert.equal(compactPreview(exact), '"' + exact + '"')
  })

  test('formats numbers', ({ assert }) => {
    assert.equal(compactPreview(42), '42')
  })

  test('formats booleans', ({ assert }) => {
    assert.equal(compactPreview(true), 'true')
    assert.equal(compactPreview(false), 'false')
  })

  test('formats empty array as "[]"', ({ assert }) => {
    assert.equal(compactPreview([]), '[]')
  })

  test('formats small array with items', ({ assert }) => {
    assert.equal(compactPreview([1, 2, 3]), '[1, 2, 3]')
  })

  test('formats array with more than 3 items (shows count)', ({ assert }) => {
    const result = compactPreview([1, 2, 3, 4, 5])
    assert.equal(result, '[1, 2, 3, ...5 items]')
  })

  test('falls back to count summary when array preview is too long', ({ assert }) => {
    const longItems = Array.from({ length: 4 }, (_, i) => 'a'.repeat(30) + i)
    const result = compactPreview(longItems, 50)
    assert.equal(result, '[4 items]')
  })

  test('formats empty object as "{}"', ({ assert }) => {
    assert.equal(compactPreview({}), '{}')
  })

  test('formats small object with key-value pairs', ({ assert }) => {
    const result = compactPreview({ a: 1, b: 2 })
    assert.equal(result, '{ a: 1, b: 2 }')
  })

  test('formats object with more than 4 keys (shows overflow count)', ({ assert }) => {
    const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 }
    const result = compactPreview(obj)
    assert.equal(result, '{ a: 1, b: 2, c: 3, d: 4, ...+1 }')
  })

  test('falls back to keys-only summary when object preview is too long', ({ assert }) => {
    const obj = { longKeyA: 'a'.repeat(30), longKeyB: 'b'.repeat(30) }
    const result = compactPreview(obj, 30)
    assert.equal(result, '{ longKeyA, longKeyB }')
  })

  test('nested objects are recursively formatted', ({ assert }) => {
    const result = compactPreview({ a: { x: 1 } })
    assert.equal(result, '{ a: { x: 1 } }')
  })

  test('nested arrays are recursively formatted', ({ assert }) => {
    const result = compactPreview([[1, 2], [3]])
    assert.equal(result, '[[1, 2], [3]]')
  })
})

// ---------------------------------------------------------------------------
// formatTtl
// ---------------------------------------------------------------------------

test.group('formatTtl', () => {
  test('returns "no expiry" for negative values', ({ assert }) => {
    assert.equal(formatTtl(-1), 'no expiry')
  })

  test('returns "no expiry" for large negative values', ({ assert }) => {
    assert.equal(formatTtl(-100), 'no expiry')
  })

  test('formats seconds (under 60)', ({ assert }) => {
    assert.equal(formatTtl(45), '45s')
  })

  test('formats 0 seconds', ({ assert }) => {
    assert.equal(formatTtl(0), '0s')
  })

  test('formats minutes (60-3599)', ({ assert }) => {
    assert.equal(formatTtl(300), '5m')
  })

  test('formats exactly 60 seconds as minutes', ({ assert }) => {
    assert.equal(formatTtl(60), '1m')
  })

  test('formats hours (3600-86399)', ({ assert }) => {
    assert.equal(formatTtl(7200), '2h')
  })

  test('formats exactly 3600 seconds as hours', ({ assert }) => {
    assert.equal(formatTtl(3600), '1h')
  })

  test('formats days (86400+)', ({ assert }) => {
    assert.equal(formatTtl(259200), '3d')
  })

  test('formats exactly 86400 seconds as days', ({ assert }) => {
    assert.equal(formatTtl(86400), '1d')
  })
})

// ---------------------------------------------------------------------------
// formatCacheSize
// ---------------------------------------------------------------------------

test.group('formatCacheSize', () => {
  test('formats bytes under 1024 as B', ({ assert }) => {
    assert.equal(formatCacheSize(128), '128B')
  })

  test('formats 0 bytes', ({ assert }) => {
    assert.equal(formatCacheSize(0), '0B')
  })

  test('formats kilobytes (1024 to 1048575)', ({ assert }) => {
    assert.equal(formatCacheSize(4300), '4.2KB')
  })

  test('formats exactly 1024 bytes as KB', ({ assert }) => {
    assert.equal(formatCacheSize(1024), '1.0KB')
  })

  test('formats megabytes (1048576+)', ({ assert }) => {
    assert.equal(formatCacheSize(1572864), '1.5MB')
  })

  test('formats exactly 1MB', ({ assert }) => {
    assert.equal(formatCacheSize(1024 * 1024), '1.0MB')
  })

  test('formats bytes just below KB boundary', ({ assert }) => {
    assert.equal(formatCacheSize(1023), '1023B')
  })
})

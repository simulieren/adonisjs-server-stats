import { test } from '@japa/runner'
import {
  rangeToMinutes,
  toSqliteTimestamp,
  roundBucket,
  rangeToCutoff,
} from '../src/utils/time_helpers.js'

test.group('rangeToMinutes', () => {
  test('returns 5 for "5m"', ({ assert }) => {
    assert.equal(rangeToMinutes('5m'), 5)
  })

  test('returns 15 for "15m"', ({ assert }) => {
    assert.equal(rangeToMinutes('15m'), 15)
  })

  test('returns 30 for "30m"', ({ assert }) => {
    assert.equal(rangeToMinutes('30m'), 30)
  })

  test('returns 60 for "1h"', ({ assert }) => {
    assert.equal(rangeToMinutes('1h'), 60)
  })

  test('returns 360 for "6h"', ({ assert }) => {
    assert.equal(rangeToMinutes('6h'), 360)
  })

  test('returns 1440 for "24h"', ({ assert }) => {
    assert.equal(rangeToMinutes('24h'), 1440)
  })

  test('returns 10080 for "7d"', ({ assert }) => {
    assert.equal(rangeToMinutes('7d'), 10080)
  })

  test('defaults to 60 for an unknown range key', ({ assert }) => {
    assert.equal(rangeToMinutes('unknown'), 60)
    assert.equal(rangeToMinutes(''), 60)
    assert.equal(rangeToMinutes('2h'), 60)
    assert.equal(rangeToMinutes('30d'), 60)
  })
})

test.group('toSqliteTimestamp', () => {
  test('formats a UTC date correctly as YYYY-MM-DD HH:MM:SS', ({ assert }) => {
    const date = new Date('2025-01-15T08:30:45Z')
    assert.equal(toSqliteTimestamp(date), '2025-01-15 08:30:45')
  })

  test('formats midnight correctly', ({ assert }) => {
    const date = new Date('2025-06-01T00:00:00Z')
    assert.equal(toSqliteTimestamp(date), '2025-06-01 00:00:00')
  })

  test('formats end of day correctly', ({ assert }) => {
    const date = new Date('2025-12-31T23:59:59Z')
    assert.equal(toSqliteTimestamp(date), '2025-12-31 23:59:59')
  })

  test('strips milliseconds from the timestamp', ({ assert }) => {
    const date = new Date('2025-03-10T14:22:33.456Z')
    assert.equal(toSqliteTimestamp(date), '2025-03-10 14:22:33')
  })

  test('output matches YYYY-MM-DD HH:MM:SS format pattern', ({ assert }) => {
    const date = new Date('2025-07-04T12:00:00Z')
    const result = toSqliteTimestamp(date)
    assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  test('handles epoch (1970-01-01)', ({ assert }) => {
    const date = new Date(0)
    assert.equal(toSqliteTimestamp(date), '1970-01-01 00:00:00')
  })
})

test.group('roundBucket', () => {
  test('rounds down to the nearest 1-minute boundary', ({ assert }) => {
    assert.equal(roundBucket('2025-01-15 08:03:45', 1), '2025-01-15 08:03:00')
    assert.equal(roundBucket('2025-01-15 08:00:00', 1), '2025-01-15 08:00:00')
  })

  test('rounds down to the nearest 5-minute boundary', ({ assert }) => {
    assert.equal(roundBucket('2025-01-15 08:07:30', 5), '2025-01-15 08:05:00')
    assert.equal(roundBucket('2025-01-15 08:04:59', 5), '2025-01-15 08:00:00')
    assert.equal(roundBucket('2025-01-15 08:10:00', 5), '2025-01-15 08:10:00')
  })

  test('rounds down to the nearest 15-minute boundary', ({ assert }) => {
    assert.equal(roundBucket('2025-01-15 08:22:00', 15), '2025-01-15 08:15:00')
    assert.equal(roundBucket('2025-01-15 08:14:59', 15), '2025-01-15 08:00:00')
    assert.equal(roundBucket('2025-01-15 08:30:00', 15), '2025-01-15 08:30:00')
    assert.equal(roundBucket('2025-01-15 08:44:59', 15), '2025-01-15 08:30:00')
    assert.equal(roundBucket('2025-01-15 08:45:00', 15), '2025-01-15 08:45:00')
  })

  test('rounds down to the nearest 60-minute boundary', ({ assert }) => {
    assert.equal(roundBucket('2025-01-15 08:59:59', 60), '2025-01-15 08:00:00')
    assert.equal(roundBucket('2025-01-15 09:00:00', 60), '2025-01-15 09:00:00')
    assert.equal(roundBucket('2025-01-15 09:30:00', 60), '2025-01-15 09:00:00')
  })

  test('handles bucket at exact boundary (no rounding needed)', ({ assert }) => {
    assert.equal(roundBucket('2025-01-15 08:00:00', 5), '2025-01-15 08:00:00')
    assert.equal(roundBucket('2025-01-15 08:00:00', 15), '2025-01-15 08:00:00')
    assert.equal(roundBucket('2025-01-15 08:00:00', 60), '2025-01-15 08:00:00')
  })
})

test.group('rangeToCutoff', () => {
  test('returns an ISO-style timestamp string in YYYY-MM-DD HH:MM:SS format', ({ assert }) => {
    const result = rangeToCutoff('1h')
    assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  test('cutoff for "5m" is approximately 5 minutes before now', ({ assert }) => {
    const before = Date.now()
    const result = rangeToCutoff('5m')
    const after = Date.now()

    const cutoffDate = new Date(result.replace(' ', 'T') + 'Z')
    const expectedMin = before - 5 * 60_000
    const expectedMax = after - 5 * 60_000

    // Allow 1 second tolerance for test execution time
    assert.isAtLeast(cutoffDate.getTime(), expectedMin - 1000)
    assert.isAtMost(cutoffDate.getTime(), expectedMax + 1000)
  })

  test('cutoff for "1h" is approximately 60 minutes before now', ({ assert }) => {
    const before = Date.now()
    const result = rangeToCutoff('1h')
    const after = Date.now()

    const cutoffDate = new Date(result.replace(' ', 'T') + 'Z')
    const expectedMin = before - 60 * 60_000
    const expectedMax = after - 60 * 60_000

    assert.isAtLeast(cutoffDate.getTime(), expectedMin - 1000)
    assert.isAtMost(cutoffDate.getTime(), expectedMax + 1000)
  })

  test('cutoff for "7d" is approximately 10080 minutes before now', ({ assert }) => {
    const before = Date.now()
    const result = rangeToCutoff('7d')
    const after = Date.now()

    const cutoffDate = new Date(result.replace(' ', 'T') + 'Z')
    const expectedMin = before - 10080 * 60_000
    const expectedMax = after - 10080 * 60_000

    assert.isAtLeast(cutoffDate.getTime(), expectedMin - 1000)
    assert.isAtMost(cutoffDate.getTime(), expectedMax + 1000)
  })

  test('unknown range defaults to 60-minute cutoff', ({ assert }) => {
    const before = Date.now()
    const result = rangeToCutoff('unknown')
    const after = Date.now()

    const cutoffDate = new Date(result.replace(' ', 'T') + 'Z')
    const expectedMin = before - 60 * 60_000
    const expectedMax = after - 60 * 60_000

    assert.isAtLeast(cutoffDate.getTime(), expectedMin - 1000)
    assert.isAtMost(cutoffDate.getTime(), expectedMax + 1000)
  })
})

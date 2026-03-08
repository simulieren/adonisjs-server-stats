import { test } from '@japa/runner'
import {
  computeStats,
  generateSparklinePoints,
  generateSparklinePath,
  generateGradientId,
  resetGradientCounter,
} from '../src/core/sparkline.js'

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

test.group('computeStats', () => {
  test('returns null for an empty array', ({ assert }) => {
    assert.isNull(computeStats([]))
  })

  test('single value yields min=max=avg=value', ({ assert }) => {
    const result = computeStats([42])!
    assert.equal(result.min, 42)
    assert.equal(result.max, 42)
    assert.equal(result.avg, 42)
  })

  test('computes correct min, max, avg for multiple values', ({ assert }) => {
    const result = computeStats([10, 20, 30])!
    assert.equal(result.min, 10)
    assert.equal(result.max, 30)
    assert.equal(result.avg, 20)
  })

  test('handles negative values', ({ assert }) => {
    const result = computeStats([-5, -10, 0, 5])!
    assert.equal(result.min, -10)
    assert.equal(result.max, 5)
    assert.equal(result.avg, -2.5)
  })

  test('all-equal values yield min=max=avg', ({ assert }) => {
    const result = computeStats([7, 7, 7, 7])!
    assert.equal(result.min, 7)
    assert.equal(result.max, 7)
    assert.equal(result.avg, 7)
  })

  test('handles large arrays correctly', ({ assert }) => {
    const values = Array.from({ length: 1000 }, (_, i) => i + 1)
    const result = computeStats(values)!
    assert.equal(result.min, 1)
    assert.equal(result.max, 1000)
    assert.equal(result.avg, 500.5)
  })

  test('handles floating-point values', ({ assert }) => {
    const result = computeStats([0.1, 0.2, 0.3])!
    assert.equal(result.min, 0.1)
    assert.equal(result.max, 0.3)
    assert.closeTo(result.avg, 0.2, 1e-10)
  })
})

// ---------------------------------------------------------------------------
// generateSparklinePoints — basic
// ---------------------------------------------------------------------------

test.group('generateSparklinePoints | basic', () => {
  test('returns null for empty array', ({ assert }) => {
    assert.isNull(generateSparklinePoints([]))
  })

  test('returns null for single value', ({ assert }) => {
    assert.isNull(generateSparklinePoints([5]))
  })

  test('returns valid points string for two values', ({ assert }) => {
    const result = generateSparklinePoints([0, 10])
    assert.isNotNull(result)
    const pairs = result!.split(' ')
    assert.lengthOf(pairs, 2)
    for (const pair of pairs) {
      assert.match(pair, /^\d+\.\d+,\d+\.\d+$/)
    }
  })

  test('returns correct number of points for multiple values', ({ assert }) => {
    const values = [1, 5, 3, 8, 2]
    const result = generateSparklinePoints(values)!
    const pairs = result.split(' ')
    assert.lengthOf(pairs, 5)
  })

  test('all-equal values do not crash (range fallback to 1)', ({ assert }) => {
    const result = generateSparklinePoints([5, 5, 5])
    assert.isNotNull(result)
    const pairs = result!.split(' ')
    assert.lengthOf(pairs, 3)
  })
})

// ---------------------------------------------------------------------------
// generateSparklinePoints — coordinate mapping
// ---------------------------------------------------------------------------

test.group('generateSparklinePoints | coordinate mapping', () => {
  test('first x starts at padding, last x ends at width - padding', ({ assert }) => {
    const width = 100
    const height = 50
    const padding = 5
    const result = generateSparklinePoints([0, 10], width, height, padding)!
    const pairs = result.split(' ')
    const [firstX] = pairs[0].split(',').map(Number)
    const [lastX] = pairs[1].split(',').map(Number)
    assert.closeTo(firstX, padding, 0.1)
    assert.closeTo(lastX, width - padding, 0.1)
  })

  test('min value maps to bottom (padding + ih), max to top (padding)', ({ assert }) => {
    const width = 100
    const height = 50
    const padding = 5
    const ih = height - padding * 2 // 40
    const result = generateSparklinePoints([0, 100], width, height, padding)!
    const pairs = result.split(' ')
    const firstY = Number(pairs[0].split(',')[1])
    const lastY = Number(pairs[1].split(',')[1])
    assert.closeTo(firstY, padding + ih, 0.1)
    assert.closeTo(lastY, padding, 0.1)
  })

  test('uses default width/height/padding when not specified', ({ assert }) => {
    const result = generateSparklinePoints([0, 10])!
    const pairs = result.split(' ')
    const firstX = Number(pairs[0].split(',')[0])
    const lastX = Number(pairs[1].split(',')[0])
    assert.closeTo(firstX, 2, 0.1) // padding
    assert.closeTo(lastX, 118, 0.1) // width - padding
  })

  test('custom width/height/padding are respected', ({ assert }) => {
    const result = generateSparklinePoints([0, 10], 200, 60, 10)!
    const pairs = result.split(' ')
    const firstX = Number(pairs[0].split(',')[0])
    const lastX = Number(pairs[1].split(',')[0])
    assert.closeTo(firstX, 10, 0.1)
    assert.closeTo(lastX, 190, 0.1)
  })
})

// ---------------------------------------------------------------------------
// generateSparklinePath
// ---------------------------------------------------------------------------

test.group('generateSparklinePath | basic', () => {
  test('returns null for empty array', ({ assert }) => {
    assert.isNull(generateSparklinePath([]))
  })

  test('returns null for single value', ({ assert }) => {
    assert.isNull(generateSparklinePath([5]))
  })

  test('valid data starts with M and ends with Z', ({ assert }) => {
    const result = generateSparklinePath([1, 5, 3])!
    assert.isTrue(result.startsWith('M'))
    assert.isTrue(result.endsWith('Z'))
  })

  test('contains L segments for each point after the first', ({ assert }) => {
    const values = [1, 5, 3, 8, 2]
    const result = generateSparklinePath(values)!
    const lSegments = result.match(/L/g)
    assert.isNotNull(lSegments)
    assert.equal(lSegments!.length, values.length - 1 + 2)
  })

  test('all-equal values do not crash (range fallback to 1)', ({ assert }) => {
    const result = generateSparklinePath([5, 5, 5])
    assert.isNotNull(result)
    assert.isTrue(result!.startsWith('M'))
    assert.isTrue(result!.endsWith('Z'))
  })
})

test.group('generateSparklinePath | coordinates', () => {
  test('closes along the bottom edge with correct coordinates', ({ assert }) => {
    const width = 100
    const height = 50
    const padding = 5
    const iw = width - padding * 2
    const ih = height - padding * 2
    const result = generateSparklinePath([0, 10], width, height, padding)!

    const lastX = (padding + iw).toFixed(1)
    const bottomY = (padding + ih).toFixed(1)
    const firstX = padding.toFixed(1)

    assert.isTrue(result.endsWith(`L${lastX},${bottomY} L${firstX},${bottomY} Z`))
  })

  test('path coordinates are consistent with generateSparklinePoints', ({ assert }) => {
    const values = [2, 8, 4, 6]
    const w = 120
    const h = 32
    const p = 2
    const points = generateSparklinePoints(values, w, h, p)!
    const path = generateSparklinePath(values, w, h, p)!

    const pointPairs = points.split(' ')
    assert.isTrue(path.startsWith(`M${pointPairs[0]}`))
    for (let i = 1; i < pointPairs.length; i++) {
      assert.include(path, `L${pointPairs[i]}`)
    }
  })
})

// ---------------------------------------------------------------------------
// generateGradientId / resetGradientCounter
// ---------------------------------------------------------------------------

test.group('generateGradientId', () => {
  test('produces sequential IDs starting from 0 after reset', ({ assert }) => {
    resetGradientCounter()
    assert.equal(generateGradientId(), 'ss-grad-0')
    assert.equal(generateGradientId(), 'ss-grad-1')
    assert.equal(generateGradientId(), 'ss-grad-2')
  })

  test('each call increments the counter', ({ assert }) => {
    resetGradientCounter()
    const ids = Array.from({ length: 5 }, () => generateGradientId())
    assert.deepEqual(ids, [
      'ss-grad-0',
      'ss-grad-1',
      'ss-grad-2',
      'ss-grad-3',
      'ss-grad-4',
    ])
  })
})

test.group('resetGradientCounter', () => {
  test('resets counter back to 0', ({ assert }) => {
    generateGradientId()
    generateGradientId()
    generateGradientId()

    resetGradientCounter()
    assert.equal(generateGradientId(), 'ss-grad-0')
  })

  test('can be called multiple times safely', ({ assert }) => {
    resetGradientCounter()
    resetGradientCounter()
    assert.equal(generateGradientId(), 'ss-grad-0')
  })
})

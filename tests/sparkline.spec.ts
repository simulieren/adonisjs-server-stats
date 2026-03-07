import { test } from '@japa/runner'
import {
  computeStats,
  generateSparklinePoints,
  generateSparklinePath,
  generateGradientId,
  resetGradientCounter,
  buildSparklineData,
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
// generateSparklinePoints
// ---------------------------------------------------------------------------

test.group('generateSparklinePoints', () => {
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
    // value 0 is min -> y = padding + ih (bottom)
    assert.closeTo(firstY, padding + ih, 0.1)
    // value 100 is max -> y = padding (top)
    assert.closeTo(lastY, padding, 0.1)
  })

  test('uses default width/height/padding when not specified', ({ assert }) => {
    // defaults: width=120, height=32, padding=2
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

test.group('generateSparklinePath', () => {
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
    // 4 L for data points after the first + 2 L for bottom-edge closure = 6 total
    const lSegments = result.match(/L/g)
    assert.isNotNull(lSegments)
    assert.equal(lSegments!.length, values.length - 1 + 2)
  })

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

  test('all-equal values do not crash (range fallback to 1)', ({ assert }) => {
    const result = generateSparklinePath([5, 5, 5])
    assert.isNotNull(result)
    assert.isTrue(result!.startsWith('M'))
    assert.isTrue(result!.endsWith('Z'))
  })

  test('path coordinates are consistent with generateSparklinePoints', ({ assert }) => {
    const values = [2, 8, 4, 6]
    const w = 120
    const h = 32
    const p = 2
    const points = generateSparklinePoints(values, w, h, p)!
    const path = generateSparklinePath(values, w, h, p)!

    const pointPairs = points.split(' ')
    // The path should start with M<first point>
    assert.isTrue(path.startsWith(`M${pointPairs[0]}`))
    // Each subsequent data point should appear as L<point>
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
    // Generate a few IDs to advance the counter
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

// ---------------------------------------------------------------------------
// buildSparklineData
// ---------------------------------------------------------------------------

test.group('buildSparklineData', () => {
  test('returns null for empty array', ({ assert }) => {
    assert.isNull(buildSparklineData([]))
  })

  test('returns null for single value', ({ assert }) => {
    assert.isNull(buildSparklineData([5]))
  })

  test('returns a complete SparklineData object for valid input', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([1, 5, 3])!
    assert.isNotNull(result)
    assert.properties(result, ['points', 'areaPath', 'gradientId', 'options', 'stats'])
  })

  test('points is a valid polyline points string', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([1, 5, 3])!
    const pairs = result.points.split(' ')
    assert.lengthOf(pairs, 3)
    for (const pair of pairs) {
      assert.match(pair, /^\d+\.\d+,\d+\.\d+$/)
    }
  })

  test('areaPath starts with M and ends with Z', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([1, 5, 3])!
    assert.isTrue(result.areaPath.startsWith('M'))
    assert.isTrue(result.areaPath.endsWith('Z'))
  })

  test('gradientId is assigned from the counter', ({ assert }) => {
    resetGradientCounter()
    const r1 = buildSparklineData([1, 2])!
    const r2 = buildSparklineData([3, 4])!
    assert.equal(r1.gradientId, 'ss-grad-0')
    assert.equal(r2.gradientId, 'ss-grad-1')
  })

  test('uses default options when none provided', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([1, 5, 3])!
    assert.equal(result.options.color, '#34d399')
    assert.equal(result.options.fillOpacityTop, 0.25)
    assert.equal(result.options.fillOpacityBottom, 0.02)
    assert.equal(result.options.strokeWidth, 1.5)
    assert.equal(result.options.width, 120)
    assert.equal(result.options.height, 32)
    assert.equal(result.options.padding, 2)
  })

  test('partial user options override defaults', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([1, 5, 3], {
      color: '#ff0000',
      width: 200,
    })!
    assert.equal(result.options.color, '#ff0000')
    assert.equal(result.options.width, 200)
    // Non-overridden defaults remain
    assert.equal(result.options.height, 32)
    assert.equal(result.options.padding, 2)
    assert.equal(result.options.strokeWidth, 1.5)
  })

  test('stats are correctly computed', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([10, 20, 30])!
    assert.isNotNull(result.stats)
    assert.equal(result.stats!.min, 10)
    assert.equal(result.stats!.max, 30)
    assert.equal(result.stats!.avg, 20)
  })

  test('points and areaPath use consistent scaling', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([2, 8, 4, 6])!
    // The first point in `points` must match the first point in `areaPath`
    const firstPointFromPoints = result.points.split(' ')[0]
    assert.isTrue(result.areaPath.startsWith(`M${firstPointFromPoints}`))
    // All data point coordinates from points should appear in the area path
    const allPoints = result.points.split(' ')
    for (let i = 1; i < allPoints.length; i++) {
      assert.include(result.areaPath, `L${allPoints[i]}`)
    }
  })

  test('all-equal values do not crash (range fallback to 1)', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([5, 5, 5, 5])
    assert.isNotNull(result)
    assert.isNotNull(result!.points)
    assert.isNotNull(result!.areaPath)
    assert.equal(result!.stats!.min, 5)
    assert.equal(result!.stats!.max, 5)
    assert.equal(result!.stats!.avg, 5)
  })

  test('custom dimensions affect point coordinates', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([0, 100], { width: 200, height: 60, padding: 10 })!
    const pairs = result.points.split(' ')
    const firstX = Number(pairs[0].split(',')[0])
    const lastX = Number(pairs[1].split(',')[0])
    assert.closeTo(firstX, 10, 0.1) // padding
    assert.closeTo(lastX, 190, 0.1) // width - padding
  })

  test('produces matching output to standalone functions', ({ assert }) => {
    resetGradientCounter()
    const values = [3, 7, 1, 9, 4]
    const bundled = buildSparklineData(values)!

    // buildSparklineData uses its own internal computation, but results should
    // match the standalone functions when called with the same defaults
    const standalonePoints = generateSparklinePoints(values, 120, 32, 2)
    const standalonePath = generateSparklinePath(values, 120, 32, 2)
    const standaloneStats = computeStats(values)

    assert.equal(bundled.points, standalonePoints)
    assert.equal(bundled.areaPath, standalonePath)
    assert.deepEqual(bundled.stats, standaloneStats)
  })

  test('handles negative values correctly', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([-10, -5, 0, 5, 10])
    assert.isNotNull(result)
    assert.equal(result!.stats!.min, -10)
    assert.equal(result!.stats!.max, 10)
    assert.equal(result!.stats!.avg, 0)
  })
})

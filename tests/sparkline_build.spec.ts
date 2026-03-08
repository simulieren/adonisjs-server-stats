import { test } from '@japa/runner'
import {
  computeStats,
  generateSparklinePoints,
  generateSparklinePath,
  buildSparklineData,
  resetGradientCounter,
} from '../src/core/sparkline.js'

// ---------------------------------------------------------------------------
// buildSparklineData — basic
// ---------------------------------------------------------------------------

test.group('buildSparklineData | basic', () => {
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
})

// ---------------------------------------------------------------------------
// buildSparklineData — options
// ---------------------------------------------------------------------------

test.group('buildSparklineData | options', () => {
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

  test('custom dimensions affect point coordinates', ({ assert }) => {
    resetGradientCounter()
    const result = buildSparklineData([0, 100], { width: 200, height: 60, padding: 10 })!
    const pairs = result.points.split(' ')
    const firstX = Number(pairs[0].split(',')[0])
    const lastX = Number(pairs[1].split(',')[0])
    assert.closeTo(firstX, 10, 0.1) // padding
    assert.closeTo(lastX, 190, 0.1) // width - padding
  })
})

// ---------------------------------------------------------------------------
// buildSparklineData — stats and consistency
// ---------------------------------------------------------------------------

test.group('buildSparklineData | stats and consistency', () => {
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
    const firstPointFromPoints = result.points.split(' ')[0]
    assert.isTrue(result.areaPath.startsWith(`M${firstPointFromPoints}`))
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

  test('produces matching output to standalone functions', ({ assert }) => {
    resetGradientCounter()
    const values = [3, 7, 1, 9, 4]
    const bundled = buildSparklineData(values)!

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

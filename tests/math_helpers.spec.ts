import { test } from '@japa/runner'
import { round, clamp } from '../src/utils/math_helpers.js'

test.group('round', () => {
  test('rounds a positive number to 2 decimal places', ({ assert }) => {
    assert.equal(round(1.005), 1)
    assert.equal(round(1.555), 1.56)
    assert.equal(round(3.14159), 3.14)
  })

  test('rounds a negative number to 2 decimal places', ({ assert }) => {
    assert.equal(round(-2.567), -2.57)
    assert.equal(round(-0.111), -0.11)
  })

  test('returns 0 for zero', ({ assert }) => {
    assert.equal(round(0), 0)
  })

  test('handles numbers with exactly 2 decimal places', ({ assert }) => {
    assert.equal(round(1.23), 1.23)
    assert.equal(round(-4.56), -4.56)
  })

  test('handles numbers with more than 2 decimal places', ({ assert }) => {
    assert.equal(round(0.12345), 0.12)
    assert.equal(round(99.999), 100)
  })

  test('handles whole numbers (no decimals)', ({ assert }) => {
    assert.equal(round(5), 5)
    assert.equal(round(-10), -10)
  })

  test('returns NaN for NaN input', ({ assert }) => {
    assert.isNaN(round(Number.NaN))
  })

  test('returns Infinity for Infinity input', ({ assert }) => {
    assert.equal(round(Infinity), Infinity)
    assert.equal(round(-Infinity), -Infinity)
  })
})

test.group('clamp', () => {
  test('returns value when within range', ({ assert }) => {
    assert.equal(clamp(5, 0, 10), 5)
    assert.equal(clamp(0.5, 0, 1), 0.5)
  })

  test('returns min when value is below min', ({ assert }) => {
    assert.equal(clamp(-5, 0, 10), 0)
    assert.equal(clamp(-100, -50, 50), -50)
  })

  test('returns max when value is above max', ({ assert }) => {
    assert.equal(clamp(15, 0, 10), 10)
    assert.equal(clamp(999, -50, 50), 50)
  })

  test('returns min/max when value equals boundary', ({ assert }) => {
    assert.equal(clamp(0, 0, 10), 0)
    assert.equal(clamp(10, 0, 10), 10)
  })

  test('returns min when min equals max', ({ assert }) => {
    assert.equal(clamp(5, 7, 7), 7)
    assert.equal(clamp(7, 7, 7), 7)
    assert.equal(clamp(-1, 7, 7), 7)
  })

  test('handles negative ranges', ({ assert }) => {
    assert.equal(clamp(-5, -10, -1), -5)
    assert.equal(clamp(-20, -10, -1), -10)
    assert.equal(clamp(0, -10, -1), -1)
  })
})

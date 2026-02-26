// ---------------------------------------------------------------------------
// SVG sparkline path generation
// ---------------------------------------------------------------------------
//
// Ported from src/edge/client/stats-bar.js `renderSparkline()`.
// This module produces the raw SVG path data; React/Vue components
// handle actual DOM rendering.
// ---------------------------------------------------------------------------

import type { SparklineOptions } from './types.js'

/**
 * Default sparkline rendering options.
 */
const DEFAULTS: Required<SparklineOptions> = {
  color: '#34d399',
  fillOpacityTop: 0.25,
  fillOpacityBottom: 0.02,
  strokeWidth: 1.5,
  width: 120,
  height: 32,
  padding: 2,
}

/**
 * Resolve user options merged with defaults.
 */
function resolveOptions(options?: SparklineOptions): Required<SparklineOptions> {
  return { ...DEFAULTS, ...options }
}

/**
 * Generate an SVG polyline `points` attribute string from an array of values.
 *
 * The values are scaled to fit within the specified dimensions,
 * normalizing against the min/max range of the data.
 *
 * @param values - Array of numeric data points (at least 2 required).
 * @param width  - SVG viewBox width.
 * @param height - SVG viewBox height.
 * @param padding - Inner padding in pixels.
 * @returns The `points` attribute value for an SVG `<polyline>`, or `null` if insufficient data.
 */
export function generateSparklinePoints(
  values: number[],
  width: number = DEFAULTS.width,
  height: number = DEFAULTS.height,
  padding: number = DEFAULTS.padding
): string | null {
  if (values.length < 2) return null

  const iw = width - padding * 2
  const ih = height - padding * 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * iw
    const y = padding + ih - ((value - min) / range) * ih
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return points.join(' ')
}

/**
 * Generate an SVG `<path>` `d` attribute for the filled area under the sparkline.
 *
 * The area path traces the sparkline from left to right, then drops
 * down to the bottom-right corner, across to the bottom-left corner,
 * and closes — suitable for use with a gradient fill.
 *
 * @param values - Array of numeric data points (at least 2 required).
 * @param width  - SVG viewBox width.
 * @param height - SVG viewBox height.
 * @param padding - Inner padding in pixels.
 * @returns The `d` attribute value for an SVG `<path>`, or `null` if insufficient data.
 */
export function generateSparklinePath(
  values: number[],
  width: number = DEFAULTS.width,
  height: number = DEFAULTS.height,
  padding: number = DEFAULTS.padding
): string | null {
  if (values.length < 2) return null

  const iw = width - padding * 2
  const ih = height - padding * 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * iw
    const y = padding + ih - ((value - min) / range) * ih
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const lastX = (padding + iw).toFixed(1)
  const bottomY = (padding + ih).toFixed(1)
  const firstX = padding.toFixed(1)

  // M to first point, L to each subsequent, then close along the bottom edge
  return (
    `M${points[0]} ` +
    points
      .slice(1)
      .map((p) => `L${p}`)
      .join(' ') +
    ` L${lastX},${bottomY} L${firstX},${bottomY} Z`
  )
}

// ---------------------------------------------------------------------------
// Gradient ID generation
// ---------------------------------------------------------------------------

let gradientCounter = 0

/**
 * Generate a unique ID for an SVG gradient definition.
 *
 * IDs are unique within the lifetime of the page (monotonic counter).
 * Safe to use for multiple sparklines rendered on the same page.
 *
 * @returns A string like `"ss-grad-0"`, `"ss-grad-1"`, etc.
 */
export function generateGradientId(): string {
  return `ss-grad-${gradientCounter++}`
}

/**
 * Reset the gradient counter (useful for tests).
 */
export function resetGradientCounter(): void {
  gradientCounter = 0
}

// ---------------------------------------------------------------------------
// Sparkline stats computation
// ---------------------------------------------------------------------------

/**
 * Computed statistics for a data series.
 */
export interface SparklineStats {
  min: number
  max: number
  avg: number
}

/**
 * Compute min, max, and average for a numeric data series.
 *
 * @param values - Array of numeric data points.
 * @returns Statistics object, or `null` if the array is empty.
 */
export function computeStats(values: number[]): SparklineStats | null {
  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length

  return { min, max, avg }
}

// ---------------------------------------------------------------------------
// Full sparkline data bundle (convenience for components)
// ---------------------------------------------------------------------------

/**
 * All data needed to render a sparkline SVG in a component.
 */
export interface SparklineData {
  /** Polyline `points` attribute. */
  points: string
  /** Filled area `path` `d` attribute. */
  areaPath: string
  /** Unique gradient ID for this sparkline. */
  gradientId: string
  /** Resolved rendering options. */
  options: Required<SparklineOptions>
  /** Computed statistics (min/max/avg). */
  stats: SparklineStats | null
}

/**
 * Build all sparkline rendering data in one call.
 *
 * @param values  - Array of numeric data points.
 * @param options - Optional rendering overrides.
 * @returns Full sparkline data bundle, or `null` if insufficient data.
 */
export function buildSparklineData(
  values: number[],
  options?: SparklineOptions
): SparklineData | null {
  const opts = resolveOptions(options)
  const points = generateSparklinePoints(values, opts.width, opts.height, opts.padding)
  const areaPath = generateSparklinePath(values, opts.width, opts.height, opts.padding)

  if (!points || !areaPath) return null

  return {
    points,
    areaPath,
    gradientId: generateGradientId(),
    options: opts,
    stats: computeStats(values),
  }
}


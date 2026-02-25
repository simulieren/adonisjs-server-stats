/**
 * Shared math utilities used across dashboard, collectors, and chart aggregator.
 */

/** Round a number to 2 decimal places. */
export function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

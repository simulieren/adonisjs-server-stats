/**
 * Shutdown helper functions extracted from ServerStatsProvider.
 */

import {
  setOnRequestComplete,
  setDashboardPath,
  setExcludedPrefixes,
} from '../middleware/request_tracking_middleware.js'
import { log } from '../utils/logger.js'

/** Timer references that need to be cleared on shutdown. */
export interface TimerRefs {
  intervalId: ReturnType<typeof setInterval> | null
  flushTimer: ReturnType<typeof setInterval> | null
  dashboardBroadcastTimer: ReturnType<typeof setInterval> | null
  debugBroadcastTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Clear all active timers and null out the references.
 * Returns the (now-nulled) timer refs for convenience.
 */
export function clearAllTimers(timers: TimerRefs): TimerRefs {
  if (timers.intervalId) {
    clearInterval(timers.intervalId)
    timers.intervalId = null
  }
  if (timers.flushTimer) {
    clearInterval(timers.flushTimer)
    timers.flushTimer = null
  }
  if (timers.dashboardBroadcastTimer) {
    clearInterval(timers.dashboardBroadcastTimer)
    timers.dashboardBroadcastTimer = null
  }
  if (timers.debugBroadcastTimer) {
    clearTimeout(timers.debugBroadcastTimer)
    timers.debugBroadcastTimer = null
  }
  return timers
}

/** Minimal interface for debug store persistence. */
interface Persistable {
  saveToDisk(path: string): Promise<void>
}

/**
 * Persist debug data to disk. Logs a warning on failure.
 */
export async function persistDebugData(
  store: Persistable | null,
  path: string | null
): Promise<void> {
  if (!path || !store) return
  try {
    await store.saveToDisk(path)
  } catch (err) {
    log.warn('could not save debug data on shutdown — ' + (err as Error)?.message)
  }
}

/** Minimal interface for unsubscribing from Redis. */
interface Unsubscribable {
  unsubscribe(channel: string): unknown
}

/**
 * Unsubscribe from the Redis email bridge channel.
 * Returns null so callers can clear their reference in one step.
 */
export function unsubscribeEmailBridge(redis: unknown, channel: string): null {
  if (!redis) return null
  try {
    ;(redis as Unsubscribable).unsubscribe(channel)
  } catch {
    // Ignore cleanup errors
  }
  return null
}

/** Stoppable service interface. */
interface Stoppable {
  stop(): void | Promise<void>
}

/**
 * Clean up log stream, dashboard, and middleware resources.
 */
export async function cleanupResources(deps: {
  logStreamService: Stoppable | null
  dashboardLogStream: Stoppable | null
  dashboardStore: Stoppable | null
  debugStore: Stoppable | null
  engine: Stoppable | null
}): Promise<void> {
  deps.logStreamService?.stop()
  deps.dashboardLogStream?.stop()
  setOnRequestComplete(null)
  setDashboardPath(null)
  setExcludedPrefixes([])
  await deps.dashboardStore?.stop()
  deps.debugStore?.stop()
  await deps.engine?.stop()
}

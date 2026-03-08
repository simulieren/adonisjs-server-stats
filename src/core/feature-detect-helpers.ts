// ---------------------------------------------------------------------------
// Data-driven helpers for feature-detect.ts
// ---------------------------------------------------------------------------

import type { FeatureFlags, FeatureConfig } from './types.js'

/**
 * Mapping from FeatureConfig keys to their default value.
 * Used to data-drive the flattenFlags function.
 */
export const FEATURE_KEYS: Array<keyof Omit<FeatureConfig, 'customPanes'>> = [
  'tracing',
  'process',
  'system',
  'http',
  'db',
  'redis',
  'queues',
  'cache',
  'app',
  'log',
  'emails',
  'dashboard',
]

/**
 * Flatten a FeatureFlags response to a FeatureConfig using the
 * data-driven FEATURE_KEYS list.
 */
export function flattenFlagsFromKeys(flags: FeatureFlags): FeatureConfig {
  const result = { customPanes: flags.customPanes ?? [] } as FeatureConfig
  for (const key of FEATURE_KEYS) {
    result[key] = (flags.features as Record<string, boolean>)?.[key] ?? false
  }
  return result
}

/**
 * Rules for mapping feature flags to metric groups in getVisibleMetricGroups.
 */
export interface FlagGroupRule {
  flag: string
  group: string
}

/**
 * Which flags enable which metric groups.
 * Some groups can be triggered by multiple flags (e.g. memory by process or system).
 */
export const FLAG_TO_GROUP: FlagGroupRule[] = [
  { flag: 'process', group: 'process' },
  { flag: 'process', group: 'memory' },
  { flag: 'system', group: 'memory' },
  { flag: 'http', group: 'http' },
  { flag: 'db', group: 'db' },
  { flag: 'redis', group: 'redis' },
  { flag: 'queues', group: 'queue' },
  { flag: 'app', group: 'app' },
  { flag: 'log', group: 'log' },
]

/**
 * Rules for detecting metric groups from actual stats data.
 * Each rule maps stat field names to a group name.
 */
export interface StatsGroupRule {
  group: string
  fields: string[]
}

export const STATS_GROUP_RULES: StatsGroupRule[] = [
  { group: 'process', fields: ['cpuPercent', 'uptime', 'nodeVersion'] },
  { group: 'memory', fields: ['memHeapUsed', 'memRss', 'systemMemoryTotalMb', 'systemMemoryFreeMb'] },
  {
    group: 'http',
    fields: ['requestsPerSecond', 'avgResponseTimeMs', 'errorRate', 'activeHttpConnections'],
  },
  { group: 'db', fields: ['dbPoolMax', 'dbPoolUsed', 'dbPoolFree', 'dbPoolPending'] },
  { group: 'queue', fields: ['queueActive', 'queueWaiting', 'queueWorkerCount'] },
  { group: 'app', fields: ['onlineUsers', 'pendingWebhooks', 'pendingEmails'] },
  { group: 'log', fields: ['logErrorsLast5m', 'logEntriesPerMinute'] },
]

/**
 * Check if a value is a number (including 0).
 */
export function hasStatValue(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v)
}

/**
 * Helpers for the boot phase of ServerStatsProvider.
 * Extracted to reduce file size and complexity.
 */

import { log, dim, bold } from '../utils/logger.js'

/**
 * Derive endpoint paths from config.
 */
export function deriveEndpointPaths(config: {
  endpoint?: string | false
  devToolbar?: { enabled?: boolean; debugEndpoint?: string; dashboard?: boolean; dashboardPath?: string }
}, dashboardDepsAvailable: boolean) {
  const statsEndpoint = typeof config.endpoint === 'string' ? config.endpoint : false
  const toolbarConfig = config.devToolbar
  const debugEndpoint = toolbarConfig?.enabled
    ? (toolbarConfig.debugEndpoint ?? '/admin/api/debug') : undefined
  const dashboardPath = toolbarConfig?.enabled && toolbarConfig.dashboard && dashboardDepsAvailable
    ? (toolbarConfig.dashboardPath ?? '/__stats') : undefined
  return { statsEndpoint, debugEndpoint, dashboardPath }
}

/**
 * Collect which route paths were registered for logging.
 */
export function collectRegisteredPaths(
  statsEndpoint: string | false,
  debugEndpoint: string | undefined,
  dashboardPath: string | undefined
): string[] {
  const paths: string[] = []
  if (typeof statsEndpoint === 'string') paths.push(statsEndpoint)
  if (debugEndpoint) paths.push(debugEndpoint + '/*')
  if (dashboardPath) paths.push(dashboardPath + '/*')
  return paths
}

/**
 * Check for required dashboard dependencies via appImport.
 * Returns list of missing dependency names (empty = all OK).
 */
export async function checkDashboardDeps(
  appImport: (name: string) => Promise<unknown>
): Promise<string[]> {
  const missing: string[] = []
  try { await appImport('knex') } catch { missing.push('knex') }
  try { await appImport('better-sqlite3') } catch { missing.push('better-sqlite3') }
  return missing
}

/**
 * Log a warning about missing dashboard dependencies.
 */
export function logMissingDeps(missing: string[]) {
  if (missing.length === 0) return
  log.block(`Dashboard requires ${missing.join(' and ')}. Install with:`, [
    '', bold(`npm install ${missing.join(' ')}`), '',
    dim('Dashboard routes have been skipped for now.'),
    dim('Everything else (stats bar, debug panel) works without it.'),
  ])
}

/**
 * Log dashboard error messages based on error category.
 */
export function logDashboardError(category: 'missing-dep' | 'timeout' | 'unknown', err: unknown) {
  if (category === 'missing-dep') {
    log.block('Dashboard could not start — missing dependencies. Install with:', [
      '', bold('npm install knex better-sqlite3'), '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
    return
  }
  if (category === 'timeout') {
    log.block('Dashboard initialization timed out', [
      dim('SQLite setup took too long — this usually means a wrong native'),
      dim('binary was loaded (common with symlinked/file: dependencies).'), '',
      dim('Try running:'), `  ${bold('npm install knex better-sqlite3')}`,
      dim('in your app directory to ensure the correct copies are used.'), '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
    return
  }
  log.warn(`Dashboard could not start: ${(err as Error)?.message}\n  ${dim('Dashboard has been disabled for this session.')}`)
  if ((err as Error)?.stack) console.error((err as Error).stack)
}

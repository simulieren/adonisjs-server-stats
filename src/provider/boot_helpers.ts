import { log, dim, bold } from '../utils/logger.js'
import {
  detectGlobalAuthMiddleware,
  buildAuthMiddlewareWarning,
} from './auth_middleware_detector.js'

import type { ResolvedServerStatsConfig } from '../types.js'

export function deriveEndpointPaths(
  endpoint: string | false | undefined,
  devToolbar?: {
    enabled?: boolean
    debugEndpoint?: string
    dashboard?: boolean
    dashboardPath?: string
  }
): { statsEndpoint: string | false; debugEndpoint: string | undefined } {
  const statsEndpoint: string | false = typeof endpoint === 'string' ? endpoint : false
  const debugEndpoint = devToolbar?.enabled
    ? (devToolbar.debugEndpoint ?? '/admin/api/debug')
    : undefined
  return { statsEndpoint, debugEndpoint }
}

export function computeDashboardPath(
  devToolbar?: { enabled?: boolean; dashboard?: boolean; dashboardPath?: string },
  depsAvailable?: boolean
): string | undefined {
  if (!devToolbar?.enabled || !devToolbar.dashboard || !depsAvailable) return undefined
  return devToolbar.dashboardPath ?? '/__stats'
}

export function collectRegisteredPaths(
  statsEndpoint: string | false,
  debugEndpoint?: string,
  dashboardPath?: string
): string[] {
  const paths: string[] = []
  if (typeof statsEndpoint === 'string') paths.push(statsEndpoint)
  if (debugEndpoint) paths.push(debugEndpoint + '/*')
  if (dashboardPath) paths.push(dashboardPath + '/*')
  return paths
}

export async function checkDashboardDeps(
  appImport: (name: string) => Promise<unknown>
): Promise<string[]> {
  const missing: string[] = []
  try {
    await appImport('knex')
  } catch {
    missing.push('knex')
  }
  try {
    await appImport('better-sqlite3')
  } catch {
    missing.push('better-sqlite3')
  }
  return missing
}

export function logMissingDeps(missing: string[]) {
  if (missing.length === 0) return
  log.block(`Dashboard requires ${missing.join(' and ')}. Install with:`, [
    '',
    bold(`npm install ${missing.join(' ')}`),
    '',
    dim('Dashboard routes have been skipped for now.'),
    dim('Everything else (stats bar, debug panel) works without it.'),
  ])
}

export function warnAboutAuthMiddleware(
  config: ResolvedServerStatsConfig,
  makePath: (dir: string, file: string) => string
) {
  if (config.shouldShow) return
  const found = detectGlobalAuthMiddleware(makePath)
  if (found.length === 0) return
  log.block(
    bold('found global auth middleware that will run on every poll:'),
    buildAuthMiddlewareWarning(found, dim, bold)
  )
}

export function logDashboardError(category: 'missing-dep' | 'timeout' | 'unknown', err: unknown) {
  if (category === 'missing-dep') {
    log.block('Dashboard could not start — missing dependencies. Install with:', [
      '',
      bold('npm install knex better-sqlite3'),
      '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
    return
  }
  if (category === 'timeout') {
    log.block('Dashboard initialization timed out', [
      dim('SQLite setup took too long — this usually means a wrong native'),
      dim('binary was loaded (common with symlinked/file: dependencies).'),
      '',
      dim('Try running:'),
      '  ' + bold('npm install knex better-sqlite3'),
      dim('in your app directory to ensure the correct copies are used.'),
      '',
      dim('Dashboard has been disabled for this session.'),
      dim('Everything else (stats bar, debug panel) works without it.'),
    ])
    return
  }
  log.warn(
    'Dashboard could not start: ' +
      ((err as Error)?.message ?? '') +
      '\n  ' +
      dim('Dashboard has been disabled for this session.')
  )
  if ((err as Error)?.stack) console.error((err as Error).stack)
}

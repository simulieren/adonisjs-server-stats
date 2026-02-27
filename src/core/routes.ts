/**
 * Maps debug panel tab IDs to their API endpoint paths.
 * The 'timeline' tab maps to '/traces' on the server.
 */
export const DEBUG_TAB_PATHS: Record<string, string> = {
  queries: '/queries',
  events: '/events',
  emails: '/emails',
  routes: '/routes',
  logs: '/logs',
  timeline: '/traces',
  cache: '/cache',
  jobs: '/jobs',
  internals: '/diagnostics',
}

export function getDebugTabPath(tab: string): string {
  return DEBUG_TAB_PATHS[tab] || `/${tab}`
}

/**
 * Maps dashboard section IDs to their API endpoint paths.
 */
export const DASHBOARD_SECTION_PATHS: Record<string, string> = {
  overview: '/overview',
  requests: '/requests',
  queries: '/queries',
  events: '/events',
  routes: '/routes',
  logs: '/logs',
  emails: '/emails',
  timeline: '/traces',
  cache: '/cache',
  jobs: '/jobs',
  config: '/config',
}

export function getDashboardSectionPath(section: string): string {
  return DASHBOARD_SECTION_PATHS[section] || `/${section}`
}

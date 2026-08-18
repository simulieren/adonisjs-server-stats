import { readFileSync } from 'node:fs'

/**
 * Check if an import path refers to an auth-related middleware
 * (excluding `initialize_auth` which only sets up ctx.auth).
 */
function isAuthMiddleware(importPath: string): boolean {
  if (importPath.includes('initialize_auth')) return false
  return (
    importPath.includes('auth') ||
    importPath.includes('silent_auth') ||
    importPath.includes('silentAuth')
  )
}

/**
 * Check if an import path refers to session middleware.
 */
function isSessionMiddleware(importPath: string): boolean {
  return importPath.includes('session')
}

/**
 * Extract import paths from a `server.use([...])` or `router.use([...])`
 * block that match the given predicate.
 */
function extractMatchingImportsFromBlock(
  block: string,
  predicate: (importPath: string) => boolean
): string[] {
  const importRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  const results: string[] = []
  let importMatch: RegExpExecArray | null
  while ((importMatch = importRegex.exec(block)) !== null) {
    const importPath = importMatch[1]
    if (predicate(importPath)) {
      results.push(importPath)
    }
  }
  return results
}

/**
 * Parse source code and detect middleware matching a predicate
 * in `server.use()` or `router.use()` blocks.
 *
 * This is a pure function that operates on source text.
 */
function detectMiddlewareInSource(
  source: string,
  predicate: (importPath: string) => boolean
): string[] {
  if (!source) return []
  const found: string[] = []
  const useBlockRegex = /(?:server|router)\.use\(\s*\[([\s\S]*?)\]\s*\)/g
  let match: RegExpExecArray | null
  while ((match = useBlockRegex.exec(source)) !== null) {
    found.push(...extractMatchingImportsFromBlock(match[1], predicate))
  }
  return found
}

/** Detect auth-related middleware in source text. */
export function detectAuthMiddlewareInSource(source: string): string[] {
  return detectMiddlewareInSource(source, isAuthMiddleware)
}

/** Detect session middleware in source text. */
export function detectSessionMiddlewareInSource(source: string): string[] {
  return detectMiddlewareInSource(source, isSessionMiddleware)
}

/**
 * Read the kernel source from disk, trying `.ts` then `.js` extensions.
 */
function readKernelSource(makePath: (dir: string, file: string) => string): string {
  for (const ext of ['ts', 'js']) {
    try {
      const source = readFileSync(makePath('start', `kernel.${ext}`), 'utf-8')
      if (source) return source
    } catch {
      // Try next extension
    }
  }
  return ''
}

/**
 * Read `start/kernel.{ts,js}` from the app root and detect global auth
 * middleware. Returns an empty array if the file cannot be read.
 */
export function detectGlobalAuthMiddleware(
  makePath: (dir: string, file: string) => string
): string[] {
  try {
    return detectAuthMiddlewareInSource(readKernelSource(makePath))
  } catch {
    return []
  }
}

/**
 * Read `start/kernel.{ts,js}` from the app root and detect global session
 * middleware. Returns an empty array if the file cannot be read.
 */
export function detectGlobalSessionMiddleware(
  makePath: (dir: string, file: string) => string
): string[] {
  try {
    return detectSessionMiddlewareInSource(readKernelSource(makePath))
  } catch {
    return []
  }
}

/**
 * Build the warning message lines for detected auth middleware.
 */
export function buildAuthMiddlewareWarning(
  found: string[],
  dimFn: (s: string) => string,
  boldFn: (s: string) => string
): string[] {
  return [
    ...found.map((m) => dimFn('→') + ' ' + m),
    '',
    dimFn('these routes get polled every ~3s, so auth middleware will'),
    dimFn('trigger a DB query on each poll. here are two ways to fix it:'),
    '',
    boldFn('option 1:') + ' add a shouldShow callback to your config:',
    '',
    dimFn('// config/server_stats.ts'),
    dimFn("shouldShow: (ctx) => ctx.auth?.user?.role === 'admin'"),
    '',
    boldFn('option 2:') + ' move auth middleware from router.use() to a route group:',
    '',
    dimFn('// start/kernel.ts — remove from router.use()'),
    dimFn("// () => import('#middleware/silent_auth_middleware')"),
    '',
    dimFn('// start/routes.ts — add to your route groups instead'),
    dimFn('router.group(() => { ... }).use(middleware.silentAuth())'),
  ]
}

/**
 * Build the warning message lines for detected session middleware.
 */
export function buildSessionMiddlewareWarning(
  found: string[],
  dimFn: (s: string) => string,
  boldFn: (s: string) => string
): string[] {
  return [
    ...found.map((m) => dimFn('→') + ' ' + m),
    '',
    dimFn('server-stats routes are polled every ~3s. global session middleware'),
    dimFn('issues a Set-Cookie on every response, which can accumulate cookies'),
    dimFn('and eventually break the browser.'),
    '',
    dimFn('server-stats already strips Set-Cookie headers from its own routes,'),
    dimFn('but for best results, move session middleware to a named route group:'),
    '',
    boldFn('// start/kernel.ts — remove from router.use()'),
    dimFn("// () => import('@adonisjs/session/session_middleware')"),
    '',
    boldFn('// start/routes.ts — add to your route groups instead'),
    dimFn("router.group(() => { ... }).use(middleware.session())"),
  ]
}

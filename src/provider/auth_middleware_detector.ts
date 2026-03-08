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
 * Extract import paths from a `server.use([...])` or `router.use([...])`
 * block that match auth-related middleware.
 */
function extractAuthImportsFromBlock(block: string): string[] {
  const importRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  const results: string[] = []
  let importMatch: RegExpExecArray | null
  while ((importMatch = importRegex.exec(block)) !== null) {
    const importPath = importMatch[1]
    if (isAuthMiddleware(importPath)) {
      results.push(importPath)
    }
  }
  return results
}

/**
 * Parse source code and detect auth-related middleware
 * in `server.use()` or `router.use()` blocks.
 *
 * This is a pure function that operates on source text.
 */
export function detectAuthMiddlewareInSource(source: string): string[] {
  if (!source) return []
  const found: string[] = []
  const useBlockRegex = /(?:server|router)\.use\(\s*\[([\s\S]*?)\]\s*\)/g
  let match: RegExpExecArray | null
  while ((match = useBlockRegex.exec(source)) !== null) {
    found.push(...extractAuthImportsFromBlock(match[1]))
  }
  return found
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

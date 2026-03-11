import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Resolution roots used by appImport, in priority order.
 * By default uses process.cwd(). Call {@link setAppRoot} to prepend
 * the AdonisJS app root (important in monorepos where cwd != app root).
 */
const resolutionRoots: string[] = [process.cwd()]

/**
 * Set the AdonisJS application root for module resolution.
 * In monorepos, cwd may be the workspace root while the app lives
 * in a sub-directory — this ensures we also look there.
 */
export function setAppRoot(appRoot: string): void {
  if (!resolutionRoots.includes(appRoot)) {
    resolutionRoots.unshift(appRoot)
  }
}

/**
 * Dynamically import a module, resolving from the app root
 * instead of from this package's location.
 *
 * Tries multiple strategies for monorepo/symlink compatibility:
 * 1. createRequire from each resolution root + ESM import
 * 2. createRequire from each resolution root + CJS require (for native modules)
 * 3. Bare import() fallback
 */
export async function appImport<T = unknown>(specifier: string): Promise<T> {
  const errors: Error[] = []

  for (const root of resolutionRoots) {
    try {
      const appRequire = createRequire(join(root, 'package.json'))
      const resolved = appRequire.resolve(specifier)

      // Strategy A: ESM import via file URL
      try {
        return await import(pathToFileURL(resolved).href)
      } catch {}

      // Strategy B: CJS require (works for native addons like better-sqlite3)
      try {
        return appRequire(specifier) as T
      } catch {}
    } catch (err) {
      errors.push(err as Error)
    }
  }

  // Strategy C: bare import (works when installed normally, not symlinked)
  try {
    return await import(specifier)
  } catch (err) {
    errors.push(err as Error)
  }

  throw errors[0] ?? new Error(`Could not import '${specifier}'`)
}

/**
 * Same as {@link appImport} but also returns the resolved file path.
 */
export async function appImportWithPath<T = unknown>(
  specifier: string
): Promise<{ module: T; resolvedPath: string }> {
  const errors: Error[] = []

  for (const root of resolutionRoots) {
    try {
      const appRequire = createRequire(join(root, 'package.json'))
      const resolved = appRequire.resolve(specifier)

      // Strategy A: ESM import via file URL
      try {
        const module = await import(pathToFileURL(resolved).href)
        return { module: module as T, resolvedPath: resolved }
      } catch {}

      // Strategy B: CJS require (works for native addons like better-sqlite3)
      try {
        const module = appRequire(specifier) as T
        return { module, resolvedPath: resolved }
      } catch {}
    } catch (err) {
      errors.push(err as Error)
    }
  }

  // Strategy C: bare import
  try {
    const module = await import(specifier)
    return { module: module as T, resolvedPath: `(bare import: ${specifier})` }
  } catch (err) {
    errors.push(err as Error)
  }

  throw errors[0] ?? new Error(`Could not import '${specifier}'`)
}

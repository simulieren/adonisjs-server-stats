import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Dynamically import a module, resolving from the app root (`process.cwd()`)
 * instead of from this package's location.
 *
 * This is critical when `adonisjs-server-stats` is symlinked into the app
 * (e.g. via `file:../../adonisjs-server-stats` in package.json). Without
 * this, Node.js dereferences the symlink and resolves bare specifiers from
 * the package's *real* directory tree — which may contain devDependency
 * stubs with different module identity than the app's actual packages.
 *
 * Falls back to a normal `import()` when `createRequire` resolution fails
 * (e.g. when the package is installed normally, not symlinked).
 */
export async function appImport<T = unknown>(specifier: string): Promise<T> {
  try {
    const appRequire = createRequire(join(process.cwd(), 'package.json'))
    const resolved = appRequire.resolve(specifier)
    return await import(pathToFileURL(resolved).href)
  } catch {
    // Fallback: normal import (works when not symlinked)
    return await import(specifier)
  }
}

/**
 * Same as {@link appImport} but also returns the resolved file path.
 * Useful for diagnostic logging.
 */
export async function appImportWithPath<T = unknown>(
  specifier: string
): Promise<{ module: T; resolvedPath: string }> {
  try {
    const appRequire = createRequire(join(process.cwd(), 'package.json'))
    const resolved = appRequire.resolve(specifier)
    const module = await import(pathToFileURL(resolved).href)
    return { module: module as T, resolvedPath: resolved }
  } catch {
    // Fallback: normal import (works when not symlinked)
    const module = await import(specifier)
    return { module: module as T, resolvedPath: `(bare import: ${specifier})` }
  }
}

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Try to locate and read the @adonisjs/transmit-client build file.
 * Returns the file contents wrapped to expose `window.Transmit`, or
 * an empty string if the package is not installed.
 *
 * @param packageJsonPath - Absolute path to a package.json for require resolution
 */
export function loadTransmitClient(packageJsonPath: string): string {
  try {
    const req = createRequire(packageJsonPath)
    const clientPath = req.resolve('@adonisjs/transmit-client/build/index.js')
    const src = readFileSync(clientPath, 'utf-8')
    return `(function(){var __exports={};(function(){${src.replace(
      /^export\s*\{[^}]*\}\s*;?\s*$/m,
      ''
    )}\n__exports.Transmit=Transmit;})();window.Transmit=__exports.Transmit;})()`
  } catch {
    return ''
  }
}

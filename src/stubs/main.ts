import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function stubsRoot() {
  return join(dirname(fileURLToPath(import.meta.url)))
}

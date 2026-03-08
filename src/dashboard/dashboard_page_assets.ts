import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log } from '../utils/logger.js'
import { loadTransmitClient } from '../utils/transmit_client.js'

const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const EDGE_DIR = join(SRC_DIR, '..', 'edge')
const STYLES_DIR = join(SRC_DIR, '..', 'styles')

/**
 * Lazily loads and caches static assets (CSS, JS, transmit client)
 * needed for the dashboard page.
 *
 * Extracted from DashboardController to reduce file size and complexity.
 */
export class DashboardPageAssets {
  private cachedCss: string | null = null
  private cachedJs: string | null = null
  private cachedTransmitClient: string | null = null

  /** Load and cache the combined CSS bundle. */
  getCss(): string {
    if (!this.cachedCss) {
      const tokens = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf-8')
      const components = readFileSync(join(STYLES_DIR, 'components.css'), 'utf-8')
      const utilities = readFileSync(join(STYLES_DIR, 'utilities.css'), 'utf-8')
      const dashboard = readFileSync(join(STYLES_DIR, 'dashboard.css'), 'utf-8')
      this.cachedCss = tokens + '\n' + components + '\n' + utilities + '\n' + dashboard
    }
    return this.cachedCss
  }

  /** Load and cache the dashboard JS bundle for the given renderer. */
  getJs(renderer: string): string {
    if (!this.cachedJs) {
      const clientDir = renderer === 'vue' ? 'client-vue' : 'client'
      this.cachedJs = readFileSync(join(EDGE_DIR, clientDir, 'dashboard.js'), 'utf-8')
    }
    return this.cachedJs
  }

  /** Load and cache the transmit client, or return empty string. */
  getTransmitClient(packageJsonPath: string): string {
    if (this.cachedTransmitClient === null) {
      this.cachedTransmitClient = loadTransmitClient(packageJsonPath)
      if (this.cachedTransmitClient) {
        log.info('Transmit client loaded for dashboard')
      } else {
        log.info(
          'Dashboard will use polling. Install @adonisjs/transmit-client for real-time updates.'
        )
      }
    }
    return this.cachedTransmitClient
  }
}

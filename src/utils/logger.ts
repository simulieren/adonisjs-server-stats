const TAG = '\x1b[36m[ \x1b[1m🔍 server-stats\x1b[0m\x1b[36m ]\x1b[0m'

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

/**
 * Whether verbose (informational) log output is enabled.
 *
 * When `false` (the default), `log.info`, `log.section`, `log.list`, and
 * `log.block` are no-ops. `log.warn` always logs regardless of this flag.
 *
 * Call {@link setVerbose} to change this at runtime (typically once during
 * provider boot, based on the user's `verbose` config option).
 */
let verbose = false

/** Enable or disable verbose informational logging. */
export function setVerbose(enabled: boolean) {
  verbose = enabled
}

export const log = {
  /** Tagged info message. Only logs when verbose mode is enabled. */
  info(message: string) {
    if (!verbose) return
    console.log(`${TAG} ${message}`)
  },

  /** Tagged warning (yellow). Always logs regardless of verbose setting. */
  warn(message: string) {
    console.warn(`${TAG} ${yellow(message)}`)
  },

  /** Tagged info with a blank line before. Only logs when verbose mode is enabled. */
  section(message: string) {
    if (!verbose) return
    console.log(`\n${TAG} ${message}`)
  },

  /** Bulleted list under a section heading. Only logs when verbose mode is enabled. */
  list(heading: string, items: string[]) {
    if (!verbose) return
    console.log(
      `\n${TAG} ${heading}\n` + items.map((item) => `  ${dim('→')} ${bold(item)}`).join('\n')
    )
  },

  /** Multi-line block (for code examples, hints, etc). Only logs when verbose mode is enabled. */
  block(heading: string, lines: string[]) {
    if (!verbose) return
    console.log(`\n${TAG} ${heading}\n` + lines.map((l) => `  ${l}`).join('\n'))
  },
}

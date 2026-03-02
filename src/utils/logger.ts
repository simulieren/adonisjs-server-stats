const TAG = '\x1b[36m[ \x1b[1m🔍 server-stats\x1b[0m\x1b[36m ]\x1b[0m'

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

export const log = {
  /** Tagged info message. */
  info(message: string) {
    console.log(`${TAG} ${message}`)
  },

  /** Tagged warning (yellow). */
  warn(message: string) {
    console.warn(`${TAG} ${yellow(message)}`)
  },

  /** Tagged info with a blank line before. */
  section(message: string) {
    console.log(`\n${TAG} ${message}`)
  },

  /** Bulleted list under a section heading. */
  list(heading: string, items: string[]) {
    console.log(
      `\n${TAG} ${heading}\n` + items.map((item) => `  ${dim('→')} ${bold(item)}`).join('\n')
    )
  },

  /** Multi-line block (for code examples, hints, etc). */
  block(heading: string, lines: string[]) {
    console.log(`\n${TAG} ${heading}\n` + lines.map((l) => `  ${l}`).join('\n'))
  },
}

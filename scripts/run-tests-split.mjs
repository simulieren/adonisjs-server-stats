/**
 * Run every spec file in its own child process and aggregate the results.
 *
 * The combined suite aborts at process exit with a better-sqlite3
 * environment-cleanup assert under Node 22+ (`RemoveEnvironmentCleanupHook:
 * (env) != nullptr`) once enough Database handles have lived in one process —
 * and the abort eats japa's summary line, so a single `npm test` is neither
 * green nor readable in CI. Individual files run and exit cleanly, so CI runs
 * them one process at a time. `npm test` (single process, fast) remains for
 * local iteration on a few files.
 */
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

const files = readdirSync('tests')
  .filter((f) => f.endsWith('.spec.ts'))
  .sort()
  .map((f) => `tests/${f}`)

let passed = 0
let failed = 0
const failures = []

for (const file of files) {
  let stdout = ''
  let exitCode = 0
  try {
    const res = await run(
      process.execPath,
      ['--import', 'tsx', 'bin/test.ts', '--files', file],
      { maxBuffer: 64 * 1024 * 1024 }
    )
    stdout = res.stdout + res.stderr
  } catch (err) {
    stdout = (err.stdout ?? '') + (err.stderr ?? '')
    exitCode = err.code ?? 1
  }

  const p = Number(/(\d+)\s+passed/.exec(stdout)?.[1] ?? 0)
  const f = Number(/(\d+)\s+failed/.exec(stdout)?.[1] ?? 0)
  passed += p
  failed += f

  // A file is red when japa reports failures, when the process died without
  // producing a summary, or when it exited non-zero.
  const hasSummary = /Tests\s+/.test(stdout)
  if (f > 0 || !hasSummary || exitCode !== 0) {
    failures.push(file)
    console.error(`FAIL ${file} (exit ${exitCode}, ${p} passed, ${f} failed)`)
    console.error(stdout.split('\n').slice(-30).join('\n'))
  } else {
    console.log(`ok   ${file} (${p})`)
  }
}

console.log(`\nTotal: ${passed} passed, ${failed} failed, ${files.length} files`)
if (failures.length > 0) {
  console.error(`Failing files:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}

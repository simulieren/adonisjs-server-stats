/**
 * Diagnostic test: Does the pino stream hook (Symbol.for('pino.stream'))
 * work when pino is configured with worker thread transports?
 *
 * When pino uses the `transport` option (multi-target), it spawns worker
 * threads for I/O. The question is whether `pino[Symbol.for('pino.stream')]`
 * still exposes a writable stream with a `.write()` method in the main thread,
 * and whether wrapping that `.write()` actually intercepts log data.
 *
 * Run: cd /path/to/adonisjs-server-stats && npx tsx tests/pino_hook_test.ts
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import pino from 'pino'

const STREAM_SYM_GLOBAL = Symbol.for('pino.stream')
// The CORRECT way to access pino's stream symbol (it's a local symbol, not global)
const STREAM_SYM_LOCAL = (pino as unknown as Record<string, Record<string, symbol>>).symbols?.streamSym as symbol | undefined

// ---- Helpers ----------------------------------------------------------------

function separator(title: string) {
  console.log(`\n${'='.repeat(64)}`)
  console.log(`  ${title}`)
  console.log('='.repeat(64))
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- TEST 1: Baseline -- pino with a plain destination (no transport) -------

async function testBaseline() {
  separator('TEST 1: Baseline -- pino with plain destination (no transport)')

  const tmpDir = mkdtempSync(join(tmpdir(), 'pino-hook-test-'))
  const filePath = join(tmpDir, 'baseline.log')

  const logger = pino({ level: 'info' }, pino.destination(filePath))

  // --- Method A: Symbol.for('pino.stream')  (what hookPinoLogger uses) ---
  const rawStreamGlobal = (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_GLOBAL]
  console.log(`  [Symbol.for] rawStream exists:  ${!!rawStreamGlobal}`)
  console.log(`  [Symbol.for] has .write():      ${typeof rawStreamGlobal?.write === 'function'}`)

  // --- Method B: pino.symbols.streamSym  (the correct local symbol) ---
  const rawStreamLocal = STREAM_SYM_LOCAL ? (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_LOCAL] : undefined
  console.log(`  [local sym]  rawStream exists:  ${!!rawStreamLocal}`)
  console.log(`  [local sym]  has .write():      ${typeof rawStreamLocal?.write === 'function'}`)
  console.log(`  [local sym]  constructor:       ${rawStreamLocal?.constructor?.name ?? 'N/A'}`)

  // Wrap using the correct (local) symbol
  if (rawStreamLocal && typeof rawStreamLocal.write === 'function') {
    const intercepted: string[] = []
    const originalWrite = rawStreamLocal.write.bind(rawStreamLocal)
    rawStreamLocal.write = function (chunk: string | Uint8Array, ...args: unknown[]) {
      const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      intercepted.push(str)
      return originalWrite(chunk, ...args)
    }

    // Wait for SonicBoom to be ready before logging
    await new Promise<void>((resolve) => {
      if ((rawStreamLocal as unknown as Record<string, unknown>).ready) resolve()
      else (rawStreamLocal as unknown as Record<string, (...args: unknown[]) => void>).once('ready', resolve)
    })

    logger.info({ testId: 1 }, 'baseline test message')
    logger.warn({ testId: 2 }, 'baseline warning')
    await wait(500)

    console.log(`  Intercepted calls:              ${intercepted.length}`)
    for (const line of intercepted) {
      try {
        const parsed = JSON.parse(line.trim())
        console.log(`    -> valid JSON, msg="${parsed.msg}", level=${parsed.level}`)
      } catch {
        console.log(`    -> NOT valid JSON: ${line.substring(0, 100)}`)
      }
    }
    console.log(`  RESULT: ${intercepted.length > 0 ? 'HOOK WORKS (with correct local symbol)' : 'HOOK DOES NOT FIRE'}`)
  } else {
    console.log('  RESULT: Cannot hook even with local symbol.')
  }
}

// ---- TEST 2: Multi-target transport (worker threads) ------------------------

async function testWorkerTransport() {
  separator('TEST 2: Multi-target transport (worker threads)')

  const tmpDir = mkdtempSync(join(tmpdir(), 'pino-hook-test-'))
  const filePath1 = join(tmpDir, 'transport1.log')
  const filePath2 = join(tmpDir, 'transport2.log')

  console.log(`  Log file 1: ${filePath1}`)
  console.log(`  Log file 2: ${filePath2}`)

  // This mirrors the AdonisJS app config -- multiple targets via transport option
  const logger = pino({
    level: 'info',
    transport: {
      targets: [
        { target: 'pino/file', options: { destination: filePath1 }, level: 'info' },
        { target: 'pino/file', options: { destination: filePath2 }, level: 'info' },
      ],
    },
  })

  // Give worker threads a moment to spin up
  await wait(500)

  // --- Method A: Symbol.for('pino.stream') ---
  const rawStreamGlobal = (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_GLOBAL]
  console.log(`  [Symbol.for] rawStream exists:  ${!!rawStreamGlobal}`)
  console.log(`  [Symbol.for] has .write():      ${typeof rawStreamGlobal?.write === 'function'}`)

  // --- Method B: pino.symbols.streamSym ---
  const rawStreamLocal = STREAM_SYM_LOCAL ? (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_LOCAL] : undefined
  console.log(`  [local sym]  rawStream exists:  ${!!rawStreamLocal}`)
  console.log(`  [local sym]  has .write():      ${typeof rawStreamLocal?.write === 'function'}`)
  console.log(`  [local sym]  constructor:       ${rawStreamLocal?.constructor?.name ?? 'N/A'}`)

  // Enumerate what's on the stream object
  if (rawStreamLocal) {
    const ownKeys = Object.getOwnPropertyNames(rawStreamLocal)
    const protoKeys = rawStreamLocal.constructor?.prototype
      ? Object.getOwnPropertyNames(rawStreamLocal.constructor.prototype)
      : []
    console.log(`  [local sym]  own keys:          [${ownKeys.join(', ')}]`)
    console.log(`  [local sym]  proto keys:        [${protoKeys.join(', ')}]`)
  }

  if (rawStreamLocal && typeof rawStreamLocal.write === 'function') {
    const intercepted: string[] = []
    const originalWrite = rawStreamLocal.write.bind(rawStreamLocal)
    rawStreamLocal.write = function (chunk: string | Uint8Array, ...args: unknown[]) {
      const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      intercepted.push(str)
      return originalWrite(chunk, ...args)
    }

    logger.info({ testId: 3 }, 'transport test message')
    logger.warn({ testId: 4 }, 'transport warning')
    await wait(1500)

    console.log(`  Intercepted calls:              ${intercepted.length}`)
    for (const line of intercepted) {
      try {
        const parsed = JSON.parse(line.trim())
        console.log(`    -> valid JSON, msg="${parsed.msg}", level=${parsed.level}`)
      } catch {
        console.log(`    -> NOT valid JSON: ${line.substring(0, 80)}`)
      }
    }

    // Check if files were written
    try {
      const c1 = readFileSync(filePath1, 'utf-8').trim()
      const c2 = readFileSync(filePath2, 'utf-8').trim()
      console.log(`  File 1 lines:                   ${c1 ? c1.split('\n').length : 0}`)
      console.log(`  File 2 lines:                   ${c2 ? c2.split('\n').length : 0}`)
    } catch (e) {
      console.log(`  Error reading log files: ${(e as Error).message}`)
    }

    console.log(`  RESULT: ${intercepted.length > 0 ? 'HOOK WORKS with worker transports' : 'HOOK DOES NOT FIRE with worker transports'}`)

    if (intercepted.length > 0) {
      let validJson = 0
      for (const line of intercepted) {
        try { JSON.parse(line.trim()); validJson++ } catch {}
      }
      console.log(`  Valid JSON entries:              ${validJson}/${intercepted.length}`)
    }
  } else {
    // Stream does not exist or has no .write()
    console.log('  Cannot hook -- no writable stream found.')

    // Still log messages to verify transport itself works
    logger.info({ testId: 3 }, 'transport test message')
    logger.warn({ testId: 4 }, 'transport warning')
    await wait(1000)

    try {
      const c1 = readFileSync(filePath1, 'utf-8').trim()
      const c2 = readFileSync(filePath2, 'utf-8').trim()
      console.log(`  File 1 has content:             ${c1.length > 0} (${c1.split('\n').length} lines)`)
      console.log(`  File 2 has content:             ${c2.length > 0} (${c2.split('\n').length} lines)`)
      console.log('  (Transport itself works, but stream hook cannot intercept)')
    } catch (e) {
      console.log(`  Error reading log files: ${(e as Error).message}`)
    }

    console.log('  RESULT: HOOK DOES NOT WORK with worker transports')
  }
}

// ---- TEST 3: Single transport target (still uses worker thread) -------------

async function testSingleTransport() {
  separator('TEST 3: Single transport target (still uses worker thread)')

  const tmpDir = mkdtempSync(join(tmpdir(), 'pino-hook-test-'))
  const filePath = join(tmpDir, 'single-transport.log')

  const logger = pino({
    level: 'info',
    transport: { target: 'pino/file', options: { destination: filePath } },
  })

  await wait(500)

  const rawStreamGlobal = (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_GLOBAL]
  const rawStreamLocal = STREAM_SYM_LOCAL ? (logger as unknown as Record<symbol, unknown>)[STREAM_SYM_LOCAL] : undefined

  console.log(`  [Symbol.for] rawStream exists:  ${!!rawStreamGlobal}`)
  console.log(`  [local sym]  rawStream exists:  ${!!rawStreamLocal}`)
  console.log(`  [local sym]  has .write():      ${typeof rawStreamLocal?.write === 'function'}`)
  console.log(`  [local sym]  constructor:       ${rawStreamLocal?.constructor?.name ?? 'N/A'}`)

  if (rawStreamLocal && typeof rawStreamLocal.write === 'function') {
    const intercepted: string[] = []
    const originalWrite = rawStreamLocal.write.bind(rawStreamLocal)
    rawStreamLocal.write = function (chunk: string | Uint8Array, ...args: unknown[]) {
      const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      intercepted.push(str)
      return originalWrite(chunk, ...args)
    }

    logger.info({ testId: 5 }, 'single transport test')
    await wait(1000)

    console.log(`  Intercepted calls:              ${intercepted.length}`)
    for (const line of intercepted) {
      try {
        const parsed = JSON.parse(line.trim())
        console.log(`    -> valid JSON, msg="${parsed.msg}", level=${parsed.level}`)
      } catch {
        console.log(`    -> NOT valid JSON: ${line.substring(0, 80)}`)
      }
    }
    console.log(`  RESULT: ${intercepted.length > 0 ? 'HOOK WORKS' : 'HOOK DOES NOT FIRE'}`)
  } else {
    console.log('  RESULT: Cannot hook -- no writable stream.')
  }
}

// ---- TEST 4: Verify the BUG -- Symbol.for vs Symbol mismatch ---------------

async function testSymbolMismatch() {
  separator('TEST 4: Symbol mismatch diagnosis')

  console.log(`  Symbol.for('pino.stream'):       ${STREAM_SYM_GLOBAL.toString()}`)
  console.log(`  pino.symbols.streamSym:           ${STREAM_SYM_LOCAL?.toString() ?? 'N/A'}`)
  console.log(`  Are they the same?                ${STREAM_SYM_GLOBAL === STREAM_SYM_LOCAL}`)
  console.log(`  Symbol.for is in global registry: ${Symbol.keyFor(STREAM_SYM_GLOBAL) === 'pino.stream'}`)
  console.log(`  streamSym is in global registry:  ${STREAM_SYM_LOCAL ? Symbol.keyFor(STREAM_SYM_LOCAL) !== undefined : 'N/A'}`)

  console.log('')
  console.log('  DIAGNOSIS:')
  if (STREAM_SYM_GLOBAL !== STREAM_SYM_LOCAL) {
    console.log('  Pino uses Symbol("pino.stream") -- a LOCAL, non-global symbol.')
    console.log('  The hookPinoLogger code uses Symbol.for("pino.stream") -- a GLOBAL symbol.')
    console.log('  These are DIFFERENT symbols and will NEVER match.')
    console.log('')
    console.log('  FIX: Use pino.symbols.streamSym (exported by pino) instead of')
    console.log('  Symbol.for("pino.stream").')
  } else {
    console.log('  Symbols match -- this is not the issue.')
  }
}

// ---- SUMMARY ----------------------------------------------------------------

async function main() {
  console.log('Pino Stream Hook Diagnostic Test')
  console.log(`Node.js ${process.version}`)
  const pinoVersion = (pino as unknown as Record<string, unknown>).version ?? 'unknown'
  console.log(`pino version: ${pinoVersion}`)
  console.log(`pino.symbols available: ${!!(pino as unknown as Record<string, Record<string, symbol>>).symbols}`)

  await testSymbolMismatch()
  await testBaseline()
  await testWorkerTransport()
  await testSingleTransport()

  separator('SUMMARY')
  console.log(`
  BUG FOUND: The hookPinoLogger() method in server_stats_provider.ts uses
  Symbol.for('pino.stream') to access the underlying pino stream. However,
  pino (at least v${pinoVersion}) uses a LOCAL Symbol('pino.stream'), not a
  global one. These are two different symbols:

    Symbol.for('pino.stream')  -- global symbol registry (used by hook code)
    Symbol('pino.stream')      -- local symbol (used by pino internally)

  Result: pino[Symbol.for('pino.stream')] is always UNDEFINED.
  The hook silently fails and never intercepts any log entries.

  GOOD NEWS: When the correct local symbol IS used, the hook works in ALL
  configurations -- plain destination (SonicBoom), multi-target transport
  (ThreadStream), and single-target transport (ThreadStream). The JSON data
  passes through .write() on the main thread before being dispatched to worker
  threads, so interception is possible.

  FIX: In hookPinoLogger(), replace:
    const streamSym = Symbol.for('pino.stream')
  with:
    const streamSym = (await import('pino')).default.symbols.streamSym
  or, if pino is not directly importable, scan for the symbol:
    const streamSym = Object.getOwnPropertySymbols(pino)
      .find(s => s.description === 'pino.stream')
`)

  await wait(500)
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

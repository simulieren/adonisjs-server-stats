import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from '@japa/runner'

import { LogStreamService } from '../src/log_stream/log_stream_service.js'
import { setVerbose } from '../src/utils/logger.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logLine(level = 30, time = Date.now(), padding = ''): string {
  return JSON.stringify({ level, time, msg: 'entry', padding }) + '\n'
}

/** Drive one poll tick directly instead of waiting on the 2s interval. */
function poll(service: LogStreamService): Promise<void> {
  return (service as unknown as { pollNewEntries(): Promise<void> }).pollNewEntries()
}

function recentEntryCount(service: LogStreamService): number {
  return (service as unknown as { recentEntries: unknown[] }).recentEntries.length
}

interface ConsoleCapture {
  warns: string[]
  logs: string[]
  restore(): void
}

function captureConsole(): ConsoleCapture {
  const warns: string[] = []
  const logs: string[] = []
  const origWarn = console.warn
  const origLog = console.log
  console.warn = (msg: unknown) => warns.push(String(msg))
  console.log = (msg: unknown) => logs.push(String(msg))
  return {
    warns,
    logs,
    restore() {
      console.warn = origWarn
      console.log = origLog
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('log stream service — forgiving polling', (group) => {
  let dir: string

  group.each.setup(async () => {
    dir = await mkdtemp(join(tmpdir(), 'log-stream-'))
    return async () => rm(dir, { recursive: true, force: true })
  })

  test('a missing log file produces no warnings, no matter how often it polls', async ({
    assert,
  }) => {
    const service = new LogStreamService(join(dir, 'does-not-exist.log'))
    const capture = captureConsole()
    try {
      await poll(service)
      await poll(service)
      await poll(service)
    } finally {
      capture.restore()
    }
    assert.lengthOf(capture.warns, 0)
  })

  test('a missing log file logs a single verbose info per failure streak', async ({ assert }) => {
    const service = new LogStreamService(join(dir, 'does-not-exist.log'))
    const capture = captureConsole()
    setVerbose(true)
    try {
      await poll(service)
      await poll(service)
      await poll(service)
    } finally {
      setVerbose(false)
      capture.restore()
    }
    const notFound = capture.logs.filter((m) => m.includes('log file not found'))
    assert.lengthOf(notFound, 1)
  })

  test('an unreadable log file warns once per failure streak, not once per poll', async ({
    assert,
  }) => {
    // A directory stats fine but fails on read, exercising the non-ENOENT path
    const service = new LogStreamService(dir)
    const capture = captureConsole()
    try {
      await poll(service)
      await poll(service)
      await poll(service)
    } finally {
      capture.restore()
    }
    const warns = capture.warns.filter((m) => m.includes('cannot read log file'))
    assert.lengthOf(warns, 1)
  })

  test('recovers when the log file appears, then warns again on the next failure streak', async ({
    assert,
  }) => {
    const logPath = join(dir, 'appears-later.log')
    const service = new LogStreamService(logPath)
    const entries: Record<string, unknown>[] = []
    ;(service as unknown as { onEntry: (e: Record<string, unknown>) => void }).onEntry = (e) =>
      entries.push(e)

    const capture = captureConsole()
    try {
      await poll(service)
      await writeFile(logPath, logLine(50) + logLine(30))
      await poll(service)
      assert.lengthOf(entries, 2)

      await unlink(logPath)
      await poll(service)
      await poll(service)
    } finally {
      capture.restore()
    }
    assert.lengthOf(capture.warns, 0)
    assert.equal(service.getLogStats().errorsLast5m, 1)
  })

  test('caps how much of a large backlog is read in a single poll', async ({ assert }) => {
    const logPath = join(dir, 'backlog.log')
    const padding = 'x'.repeat(1024)
    const totalLines = 8192 // ~8.5 MB, well over the 4 MB per-poll cap
    const lines: string[] = []
    for (let i = 0; i < totalLines; i++) {
      lines.push(logLine(30, Date.now(), padding))
    }
    await writeFile(logPath, lines.join(''))

    const service = new LogStreamService(logPath)
    let processed = 0
    ;(service as unknown as { onEntry: (e: Record<string, unknown>) => void }).onEntry = () =>
      processed++

    await poll(service)

    assert.isBelow(processed, totalLines)
    assert.isAbove(processed, 0)

    // The skipped backlog is not re-read on the next poll
    processed = 0
    await poll(service)
    assert.equal(processed, 0)
  })

  test('caps recentEntries growth in the file-poll path', async ({ assert }) => {
    const logPath = join(dir, 'chatty.log')
    const now = Date.now()
    const totalLines = 12_000
    const lines: string[] = []
    for (let i = 0; i < totalLines; i++) {
      lines.push(logLine(30, now))
    }
    await writeFile(logPath, lines.join(''))

    const service = new LogStreamService(logPath)
    await poll(service)

    assert.isAtMost(recentEntryCount(service), 10_000)
  })
})

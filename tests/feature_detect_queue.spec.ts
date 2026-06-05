import { test } from '@japa/runner'
import { adonisQueueCollector } from '../src/collectors/adonisjs_queue_collector.js'

// ---------------------------------------------------------------------------
// auto_detect coverage for the @adonisjs/queue boot path
//
// NOTE: isInstalled() and appImport() resolve against the host file system via
// a dynamic import chain.  We cannot stub them without an ESM mocking framework
// (e.g. vitest mocks or a node --loader hook), so the autoDetectCollectors()
// integration path is not exercised here.
//
// What we CAN assert without side-effects:
//   - adonisQueueCollector is exported from src/collectors/index.ts
//   - The produced collector has name === 'queue'
// ---------------------------------------------------------------------------

test.group('auto_detect | adonisQueueCollector export', () => {
  test('adonisQueueCollector is exported from src/collectors/index.ts', async ({ assert }) => {
    // Dynamic import from the barrel — if the export is missing this will throw.
    const mod = await import('../src/collectors/index.js')

    assert.isFunction((mod as Record<string, unknown>).adonisQueueCollector)
  })

  test('collector produced by adonisQueueCollector has name "queue"', ({ assert }) => {
    const collector = adonisQueueCollector()

    assert.equal(collector.name, 'queue')
  })

  test('collector has a label string', ({ assert }) => {
    const collector = adonisQueueCollector()

    assert.isString(collector.label)
    assert.isAbove(collector.label!.length, 0)
  })

  test('collector exposes getConfig()', ({ assert }) => {
    const collector = adonisQueueCollector()

    assert.isFunction(collector.getConfig)
  })

  test('getConfig source identifies @adonisjs/queue', ({ assert }) => {
    const collector = adonisQueueCollector()
    const config = collector.getConfig!() as Record<string, unknown>

    assert.equal(config.source, '@adonisjs/queue')
  })
})

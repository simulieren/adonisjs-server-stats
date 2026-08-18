import { test } from '@japa/runner'
import { prepareRequestRows } from '../src/dashboard/write_queue.js'
import { EventCollector } from '../src/debug/event_collector.js'

import type { EventRecord } from '../src/debug/types.js'
import type { PersistRequestInput } from '../src/dashboard/dashboard_types.js'

function makeRequest(overrides: Partial<PersistRequestInput> = {}): PersistRequestInput {
  return {
    method: 'GET',
    url: '/',
    statusCode: 200,
    duration: 1,
    queries: [],
    trace: null,
    ...overrides,
  }
}

function event(id: number, name: string): EventRecord {
  return { id, event: name, data: null, timestamp: Date.now() }
}

function collectorWith(...names: string[]): EventCollector {
  const collector = new EventCollector(10)
  collector.loadRecords(names.map((name, i) => event(i + 1, name)))
  return collector
}

test.group('EventCollector.getEventsSince', () => {
  test('returns everything when the cursor is unset', ({ assert }) => {
    assert.lengthOf(collectorWith('a', 'b').getEventsSince(0), 2)
  })

  test('returns only events after the cursor, oldest first', ({ assert }) => {
    const rest = collectorWith('a', 'b', 'c').getEventsSince(1)

    assert.deepEqual(
      rest.map((e) => e.event),
      ['b', 'c']
    )
  })

  test('returns nothing when the cursor is current', ({ assert }) => {
    assert.isEmpty(collectorWith('a', 'b').getEventsSince(2))
  })

  test('the cursor survives ring-buffer eviction', ({ assert }) => {
    // Capacity 10, 14 events pushed: the oldest four are gone, and the cursor
    // must not resurrect them or skip the survivors.
    const collector = new EventCollector(10)
    collector.loadRecords(Array.from({ length: 14 }, (_, i) => event(i + 1, `e${i + 1}`)))

    const since = collector.getEventsSince(10)

    assert.deepEqual(
      since.map((e) => e.event),
      ['e11', 'e12', 'e13', 'e14']
    )
  })
})

test.group('event rows on a prepared request', () => {
  test('events on the input become event rows', ({ assert }) => {
    const [prepared] = prepareRequestRows([
      makeRequest({ events: [event(1, 'user:registered'), event(2, 'order:placed')] }),
    ])

    assert.lengthOf(prepared.eventRows, 2)
    assert.equal(prepared.eventRows[0].event_name, 'user:registered')
    assert.equal(prepared.eventRows[1].event_name, 'order:placed')
  })

  test('no events yields no rows', ({ assert }) => {
    const [prepared] = prepareRequestRows([makeRequest({ events: [] })])

    assert.isEmpty(prepared.eventRows)
  })

  test('an input without an events field is accepted', ({ assert }) => {
    // `events` is optional so a caller built before this existed still works.
    const [prepared] = prepareRequestRows([makeRequest()])

    assert.isEmpty(prepared.eventRows)
  })

  test('rows carry no request_id — it is attached at insert time', ({ assert }) => {
    const [prepared] = prepareRequestRows([makeRequest({ events: [event(1, 'a')] })])

    assert.notProperty(prepared.eventRows[0], 'request_id')
  })
})

test.group('the dead queueEvents API is gone', () => {
  test('DashboardStore no longer exposes queueEvents', async ({ assert }) => {
    const { DashboardStore } = await import('../src/dashboard/dashboard_store.js')

    // It looked wired up but had no callers, so `server_stats_events` was never
    // written and the dashboard's Events tab was permanently empty.
    assert.isUndefined(
      (DashboardStore.prototype as unknown as Record<string, unknown>).queueEvents
    )
  })

  test('FlushManager no longer exposes queueEvents', async ({ assert }) => {
    const { FlushManager } = await import('../src/dashboard/flush_manager.js')

    assert.isUndefined((FlushManager.prototype as unknown as Record<string, unknown>).queueEvents)
  })
})

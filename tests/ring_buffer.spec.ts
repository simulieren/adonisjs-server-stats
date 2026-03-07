import { test } from '@japa/runner'
import { RingBuffer } from '../src/debug/ring_buffer.js'

interface TestItem {
  id: number
  value: string
}

test.group('RingBuffer | functional', () => {
  test('push and toArray return items in insertion order (oldest first)', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    buf.push({ id: buf.getNextId(), value: 'c' })

    const items = buf.toArray()
    assert.lengthOf(items, 3)
    assert.equal(items[0].value, 'a')
    assert.equal(items[1].value, 'b')
    assert.equal(items[2].value, 'c')
  })

  test('push overwrites oldest when at capacity', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(3)
    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    buf.push({ id: buf.getNextId(), value: 'c' })
    buf.push({ id: buf.getNextId(), value: 'd' })
    buf.push({ id: buf.getNextId(), value: 'e' })

    const items = buf.toArray()
    assert.lengthOf(items, 3)
    assert.equal(items[0].value, 'c')
    assert.equal(items[1].value, 'd')
    assert.equal(items[2].value, 'e')
  })

  test('latest(n) returns most recent N items in newest-first order', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(10)
    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    buf.push({ id: buf.getNextId(), value: 'c' })
    buf.push({ id: buf.getNextId(), value: 'd' })

    const latest = buf.latest(2)
    assert.lengthOf(latest, 2)
    assert.equal(latest[0].value, 'd')
    assert.equal(latest[1].value, 'c')
  })

  test('getNextId returns monotonically increasing IDs', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    const id1 = buf.getNextId()
    const id2 = buf.getNextId()
    const id3 = buf.getNextId()

    assert.equal(id1, 1)
    assert.equal(id2, 2)
    assert.equal(id3, 3)
    assert.isTrue(id1 < id2)
    assert.isTrue(id2 < id3)
  })

  test('size and getCapacity are correct after push and clear', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    assert.equal(buf.size(), 0)
    assert.equal(buf.getCapacity(), 5)

    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    assert.equal(buf.size(), 2)

    buf.push({ id: buf.getNextId(), value: 'c' })
    buf.push({ id: buf.getNextId(), value: 'd' })
    buf.push({ id: buf.getNextId(), value: 'e' })
    assert.equal(buf.size(), 5)

    // Pushing beyond capacity does not increase size past capacity
    buf.push({ id: buf.getNextId(), value: 'f' })
    assert.equal(buf.size(), 5)
    assert.equal(buf.getCapacity(), 5)

    buf.clear()
    assert.equal(buf.size(), 0)
    assert.equal(buf.getCapacity(), 5)
  })

  test('clear resets size to 0 and empties the buffer', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    buf.push({ id: buf.getNextId(), value: 'c' })

    buf.clear()
    assert.equal(buf.size(), 0)
    assert.deepEqual(buf.toArray(), [])
  })
})

test.group('RingBuffer | performance-critical methods', () => {
  test('findFromEnd returns the last matching item without copying', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(10)
    buf.push({ id: buf.getNextId(), value: 'alpha' })
    buf.push({ id: buf.getNextId(), value: 'beta' })
    buf.push({ id: buf.getNextId(), value: 'alpha' })
    buf.push({ id: buf.getNextId(), value: 'gamma' })

    const found = buf.findFromEnd((item) => item.value === 'alpha')
    assert.isDefined(found)
    assert.equal(found!.id, 3) // The second 'alpha', which is the last match
    assert.equal(found!.value, 'alpha')
  })

  test('findFromEnd returns undefined when no match', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    buf.push({ id: buf.getNextId(), value: 'a' })

    const found = buf.findFromEnd((item) => item.value === 'zzz')
    assert.isUndefined(found)
  })

  test('findFromEnd is faster than toArray().find() for large buffers', ({ assert }) => {
    const size = 10_000
    const buf = new RingBuffer<TestItem>(size)
    for (let i = 0; i < size; i++) {
      buf.push({ id: buf.getNextId(), value: `item-${i}` })
    }

    // Target item is near the end, so findFromEnd should be fast
    const targetValue = `item-${size - 5}`

    const iterations = 100

    const startFindFromEnd = performance.now()
    for (let i = 0; i < iterations; i++) {
      buf.findFromEnd((item) => item.value === targetValue)
    }
    const findFromEndTime = performance.now() - startFindFromEnd

    const startToArrayFind = performance.now()
    for (let i = 0; i < iterations; i++) {
      buf.toArray().reverse().find((item) => item.value === targetValue)
    }
    const toArrayFindTime = performance.now() - startToArrayFind

    // findFromEnd should be significantly faster because it doesn't copy the buffer
    assert.isTrue(
      findFromEndTime < toArrayFindTime,
      `findFromEnd (${findFromEndTime.toFixed(2)}ms) should be faster than toArray().find() (${toArrayFindTime.toFixed(2)}ms)`
    )
  })

  test('collectFromEnd collects items matching predicate from newest to oldest', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(10)
    buf.push({ id: buf.getNextId(), value: 'a' })
    buf.push({ id: buf.getNextId(), value: 'b' })
    buf.push({ id: buf.getNextId(), value: 'c' })
    buf.push({ id: buf.getNextId(), value: 'd' })
    buf.push({ id: buf.getNextId(), value: 'e' })

    // Collect items with id > 3 (should be d=4, e=5)
    const collected = buf.collectFromEnd((item) => item.id > 3)
    assert.lengthOf(collected, 2)
    // Returned in insertion order (oldest first)
    assert.equal(collected[0].value, 'd')
    assert.equal(collected[1].value, 'e')
  })

  test('collectFromEnd stops at first non-match and does not scan entire buffer', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(10)
    let predicateCalls = 0

    buf.push({ id: buf.getNextId(), value: 'a' }) // id=1
    buf.push({ id: buf.getNextId(), value: 'b' }) // id=2
    buf.push({ id: buf.getNextId(), value: 'c' }) // id=3
    buf.push({ id: buf.getNextId(), value: 'd' }) // id=4
    buf.push({ id: buf.getNextId(), value: 'e' }) // id=5

    const collected = buf.collectFromEnd((item) => {
      predicateCalls++
      return item.id > 3
    })

    assert.lengthOf(collected, 2)
    // Should have called predicate 3 times: id=5 (true), id=4 (true), id=3 (false -> stop)
    assert.equal(predicateCalls, 3)
  })

  test('onPush callback fires on each push', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(5)
    const received: TestItem[] = []

    buf.onPush((item) => {
      received.push(item)
    })

    const item1 = { id: buf.getNextId(), value: 'x' }
    const item2 = { id: buf.getNextId(), value: 'y' }
    buf.push(item1)
    buf.push(item2)

    assert.lengthOf(received, 2)
    assert.deepEqual(received[0], item1)
    assert.deepEqual(received[1], item2)
  })

  test('load bulk-loads items and setNextId restores the counter', ({ assert }) => {
    const buf = new RingBuffer<TestItem>(10)

    const items: TestItem[] = [
      { id: 10, value: 'loaded-a' },
      { id: 11, value: 'loaded-b' },
      { id: 12, value: 'loaded-c' },
    ]

    buf.load(items)
    assert.equal(buf.size(), 3)

    const arr = buf.toArray()
    assert.deepEqual(arr, items)

    // Restore nextId to continue from max loaded id
    buf.setNextId(13)
    assert.equal(buf.getNextId(), 13)
    assert.equal(buf.getNextId(), 14)
  })
})

test.group('RingBuffer | perf regression', () => {
  test('toArray with full buffer is O(N) and returns all items in order', ({ assert }) => {
    const size = 10_000
    const buf = new RingBuffer<TestItem>(size)

    for (let i = 0; i < size; i++) {
      buf.push({ id: buf.getNextId(), value: `v${i}` })
    }

    const arr = buf.toArray()
    assert.lengthOf(arr, size)

    // Verify insertion order is preserved
    for (let i = 0; i < size; i++) {
      assert.equal(arr[i].id, i + 1)
      assert.equal(arr[i].value, `v${i}`)
    }
  })

  test('collectFromEnd is O(K) not O(N) for recent items', ({ assert }) => {
    const size = 10_000
    const buf = new RingBuffer<TestItem>(size)

    // Fill the entire buffer
    for (let i = 0; i < size; i++) {
      buf.push({ id: buf.getNextId(), value: `v${i}` })
    }

    const lastId = size // Last ID after filling the buffer

    // Push 5 more items (these overwrite the oldest 5)
    for (let i = 0; i < 5; i++) {
      buf.push({ id: buf.getNextId(), value: `new-${i}` })
    }

    // collectFromEnd with predicate id > lastId should return exactly 5 items
    let predicateCalls = 0
    const collected = buf.collectFromEnd((item) => {
      predicateCalls++
      return item.id > lastId
    })

    assert.lengthOf(collected, 5)
    // Verify they are the 5 new items in insertion order
    assert.equal(collected[0].value, 'new-0')
    assert.equal(collected[1].value, 'new-1')
    assert.equal(collected[2].value, 'new-2')
    assert.equal(collected[3].value, 'new-3')
    assert.equal(collected[4].value, 'new-4')

    // Predicate should have been called 6 times (5 matches + 1 non-match to stop)
    // This proves it did NOT scan all 10000 items
    assert.equal(predicateCalls, 6)
  })
})

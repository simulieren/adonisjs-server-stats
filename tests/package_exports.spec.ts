import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from '@japa/runner'

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test.group('core barrel exports field-resolvers', () => {
  test('all field resolver functions are re-exported from core/index', async ({ assert }) => {
    const core = await import('../src/core/index.js')

    const expectedExports = [
      'resolveField',
      'resolveTimestamp',
      'resolveJobTimestamp',
      'resolveStatusCode',
      'resolveDuration',
      'resolveSpanCount',
      'resolveWarningCount',
      'resolveFromAddr',
      'resolveToAddr',
      'resolveCcAddr',
      'resolveAttachmentCount',
      'resolveEventName',
      'resolveSqlMethod',
      'resolveNormalizedSql',
      'resolveMetric',
    ]

    for (const name of expectedExports) {
      assert.isFunction(core[name], `core/index should export "${name}" as a function`)
    }
  })
})

test.group('dist build artifacts', () => {
  test('dist/core/index.js contains field resolver exports', async ({ assert }) => {
    const content = await readFile(join(PKG_ROOT, 'dist/core/index.js'), 'utf-8')

    const expectedNames = [
      'resolveTimestamp',
      'resolveEventName',
      'resolveNormalizedSql',
      'resolveStatusCode',
      'resolveDuration',
      'resolveSpanCount',
      'resolveWarningCount',
      'resolveField',
      'resolveMetric',
    ]

    for (const name of expectedNames) {
      assert.isTrue(
        content.includes(name),
        `dist/core/index.js should contain export "${name}"`
      )
    }
  })

  test('dist/core/index.d.ts contains field resolver type declarations', async ({ assert }) => {
    const content = await readFile(join(PKG_ROOT, 'dist/core/index.d.ts'), 'utf-8')

    const expectedNames = [
      'resolveTimestamp',
      'resolveEventName',
      'resolveNormalizedSql',
      'resolveField',
      'resolveMetric',
    ]

    for (const name of expectedNames) {
      assert.isTrue(
        content.includes(name),
        `dist/core/index.d.ts should declare "${name}"`
      )
    }
  })

  test('dist/react/index.d.ts exists at the correct path (not nested in react/react/)', async ({ assert }) => {
    const correctPath = join(PKG_ROOT, 'dist/react/index.d.ts')
    const wrongPath = join(PKG_ROOT, 'dist/react/react/index.d.ts')

    let correctExists = true
    try {
      await access(correctPath)
    } catch {
      correctExists = false
    }

    let wrongExists = true
    try {
      await access(wrongPath)
    } catch {
      wrongExists = false
    }

    assert.isTrue(correctExists, 'dist/react/index.d.ts should exist')
    assert.isFalse(wrongExists, 'dist/react/react/index.d.ts should NOT exist (wrong nesting)')
  })

  test('dist/react/index.d.ts exports React components', async ({ assert }) => {
    const content = await readFile(join(PKG_ROOT, 'dist/react/index.d.ts'), 'utf-8')

    assert.isTrue(content.includes('StatsBar'), 'should export StatsBar')
    assert.isTrue(content.includes('DebugPanel'), 'should export DebugPanel')
    assert.isTrue(content.includes('DashboardPage'), 'should export DashboardPage')
  })

  test('package.json export paths match actual files', async ({ assert }) => {
    const pkgJson = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf-8'))
    const exports = pkgJson.exports

    const criticalPaths = [
      exports['./core']?.import,
      exports['./core']?.types,
      exports['./react']?.import,
      exports['./react']?.types,
      exports['./vue']?.import,
      exports['./vue']?.types,
    ].filter(Boolean)

    for (const relPath of criticalPaths) {
      const absPath = join(PKG_ROOT, relPath)
      let exists = true
      try {
        await access(absPath)
      } catch {
        exists = false
      }
      assert.isTrue(exists, `export path "${relPath}" should exist on disk`)
    }
  })
})

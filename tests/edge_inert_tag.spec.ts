import { test } from '@japa/runner'
import { Edge } from 'edge.js'

import { edgePluginServerStatsInert } from '../src/edge/plugin.js'

const LAYOUT = '<body>\n    @serverStats()\n  </body>'

test.group('Edge tag when the stats bar is inactive', () => {
  test('an unregistered @serverStats() leaks into the page as text', async ({ assert }) => {
    const edge = Edge.create()
    edge.registerTemplate('layout', { template: LAYOUT })

    const html = await edge.render('layout', {})

    assert.include(html, '@serverStats()')
  })

  test('the inert plugin compiles @serverStats() to nothing', async ({ assert }) => {
    const edge = Edge.create()
    edge.use(edgePluginServerStatsInert())
    edge.registerTemplate('layout', { template: LAYOUT })

    const html = await edge.render('layout', {})

    assert.notInclude(html, 'serverStats')
    assert.equal(html.replace(/\s+/g, ''), '<body></body>')
  })
})

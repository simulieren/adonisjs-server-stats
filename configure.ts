import { stubsRoot } from './src/stubs/main.js'

import type Configure from '@adonisjs/core/commands/configure'

/** Minimal interface for the AdonisJS RC file transformer. */
interface RcFileTransformer {
  addProvider(path: string, environments?: string[]): this
}

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // Publish config file
  await codemods.makeUsingStub(stubsRoot(), 'config.stub', {})

  // Register provider in adonisrc.ts
  await codemods.updateRcFile((rcFile: RcFileTransformer) => {
    rcFile.addProvider('adonisjs-server-stats/provider', ['web'])
    rcFile.addProvider('adonisjs-server-stats/log-stream/provider', ['web'])
  })
}

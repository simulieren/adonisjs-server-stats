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

  // The log-stream provider relies on @adonisjs/transmit for live log
  // streaming, so only register it when the user opts in.
  const enableLogStream = await command.prompt.confirm(
    'Register the log-stream provider? (requires @adonisjs/transmit for live log streaming)',
    { default: false }
  )

  // Register provider in adonisrc.ts
  await codemods.updateRcFile((rcFile: RcFileTransformer) => {
    rcFile.addProvider('adonisjs-server-stats/provider', ['web'])
    if (enableLogStream) {
      rcFile.addProvider('adonisjs-server-stats/log-stream/provider', ['web'])
    }
  })
}

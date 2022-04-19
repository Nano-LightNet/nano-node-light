import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import NanoNode from '#lib/nano-node.js'
import { constants } from '#common'

const argv = yargs(hideBin(process.argv)).argv

const log = debug('bin')
debug.enable('*')

if (!argv.address) {
  log('missing --address')
  process.exit()
}

if (!argv.port) {
  log('missing --port')
  process.exit()
}

const getNetwork = (network = 'beta') => {
  switch (network) {
    case 'live':
      return constants.NETWORK.LIVE
    case 'beta':
      return constants.NETWORK.BETA
    case 'test':
      return constants.NETWORK.TEST
    default:
      return constants.NETWORK.BETA
  }
}

const network = getNetwork(argv.network)
const node = new NanoNode({
  address: argv.address,
  port: argv.port,
  network,
  requestTelemetry: true
})

node.on('error', (error) => {
  console.log(error)
})

node.on('telemetry', (telemetry) => {
  log(telemetry)
})

node.connect({
  address: network.ADDRESS,
  port: network.PORT
})

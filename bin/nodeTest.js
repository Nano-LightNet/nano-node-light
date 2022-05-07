import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import NanoNode from '#lib/nano-node.js'
import { constants } from '#common'
import * as ed25519 from '#common/ed25519.js'

const argv = yargs(hideBin(process.argv)).argv

let PrivateKey = Buffer.alloc(32, 0)

const PrivateKeyRegex = /^[0-9a-fA-F]{64}$/

if (typeof argv.PrivateKey === 'string' && PrivateKeyRegex.test(argv.PrivateKey)) {
  PrivateKey = Buffer.from(argv.PrivateKey, 'hex')
}

const PublicKey = Buffer.from(ed25519.getPublicKey(PrivateKey))

const log = debug('bin')
debug.enable('*')

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
const config = {
  network,
  requestTelemetry: argv.telemetry
}

const serverNode = new NanoNode(config)

serverNode.on('error', (error) => {
  console.log(error)
})

serverNode.on('telemetry', (telemetry) => {
  log(telemetry)
})

serverNode.listen({
  port: 8000
})

const node = new NanoNode(config)

node.on('error', (error) => {
  console.log(error)
})

node.on('telemetry', (telemetry) => {
  log(telemetry)
})

node.connect({
  address: '127.0.0.1',
  port: 8000
})
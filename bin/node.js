import debug from 'debug'
import express from 'express'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import NanoNode from '#lib/nano-node.js'
import { constants } from '#common'

const argv = yargs(hideBin(process.argv)).argv

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
const node = new NanoNode(config)

node.on('error', (error) => {
  console.log(error)
})

node.on('telemetry', (telemetry) => {
  log(telemetry)
})

// connect to network bootstrap peers
node.connectDomain({
  address: network.ADDRESS,
  port: network.PORT
})

const app = express()

app.get('/', (req, res) => {
  let peerCount = 0n

  for (const peer of node.peers.values()) {
    if (peer && peer.nanoSocket.connectedNodeId) peerCount++
  }
  res.json({
      peerCount: peerCount.toString()
  })
})

app.listen(80)

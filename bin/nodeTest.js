import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import NanoNode from '#lib/nano-node.js'
import { constants, encodeVote } from '#common'
import * as ed25519 from '#common/ed25519.js'

const argv = yargs(hideBin(process.argv)).argv

let PrivateKey = Buffer.alloc(32, 0)

const PrivateKeyRegex = /^[0-9a-fA-F]{64}$/

if (typeof argv.PrivateKey === 'string' && PrivateKeyRegex.test(argv.PrivateKey)) {
  PrivateKey = Buffer.from(argv.PrivateKey, 'hex')
}

const PublicKey = Buffer.from(ed25519.getPublicKey(PrivateKey))

const testConfirmAck = encodeVote({
    publicKey: PublicKey,
    privateKey: PrivateKey,
    hashList: [
        Buffer.from('9C695F34AC5F5A521A0E26EAA1A167961E3F30C8D8E0979733BB2C2D1949F5C8', 'hex')
    ]
})

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

let firstConnect = false

node.on('handshake', ({ nodeId }) => {
  if (firstConnect) return
  firstConnect = true

  for (const peer of node.peers.values()) {
    peer.nanoSocket.sendMessage({
      messageType: constants.MESSAGE_TYPE.CONFIRM_ACK,
      message: testConfirmAck.body,
      extensions: testConfirmAck.extensions
    })
  }
})

node.connect({
  address: '127.0.0.1',
  port: 8000
})

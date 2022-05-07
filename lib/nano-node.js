import EventEmitter from 'events'
import crypto from 'crypto'
import net from 'net'
import debug from 'debug'
import dns from 'dns'

import {
  constants,
  ed25519,
  encodeAddress,
  encodeConnectionInfo
} from '#common'

import NanoSocket from './nano-socket.js'

const log = debug('node')

class NanoRepresentative {
  constructor(account) {
    this.account = account
    this.votes = 0
    this.last_vote = null
  }
}

class NanoPeer {
  constructor({ peerAddress, nanoSocket }) {
    this.nodeId = null
    this.address = peerAddress
    this.messages = 0
    this.last_message = null
    this.nanoSocket = nanoSocket
    this.telemetry = null
    this.last_telemetry_req = null
  }
}

const defaultConfig = {
  discover: true,
  requestTelemetry: false,
  maxPeers: Infinity
}

export default class NanoNode extends EventEmitter {
  constructor({ network = constants.NETWORK.BETA, ...config } = {}) {
    super()

    this.network = network
    this.config = Object.assign(defaultConfig, config)

    const NodeSecret = crypto.randomBytes(32)
    const NodePublic = ed25519.getPublicKey(NodeSecret)
    this.nodeKey = {
      secret: NodeSecret,
      public: NodePublic
    }
    this.NodeID = encodeAddress({ publicKey: NodePublic, prefix: 'node_' })

    log(`Node Secret: ${NodeSecret.toString('hex')}`)
    log(`Node Public: ${Buffer.from(NodePublic).toString('hex')}`)
    log(`Node ID: ${this.NodeID}`)

    this.peers = new Map()
    this.representatives = new Map()

    // [BlockHash]: { voters: [ Voting Account(s) ], votingWeight: Total Voting Weight, state: 0 (Passive) 1 (Active) 2 (Requesting) 3 (Broadcasting) 4 (Confirmed), requestCount: Amount of times Node has requested vote for this Election, started: Time Election Started }
    this.elections = {}

    // [BlockHash]: { voters: [ Voting Account(s) ], votingWeight: Total Voting Weight }
    this.inactiveElections = {}

    if (this.config.requestTelemetry) {
      this._telemetryInterval = setInterval(
        this.telemetryLoop.bind(this),
        // convert nanoseconds to milliseconds
        network.TELEMETRY_CACHE_CUTOFF / 1e6
      )
    }
  }

  stop() {
    if (this._telemetryInterval) {
      clearInterval(this._telemetryInterval)
    }

    if (this.server) {
      this.server.close()
    }

    for (const peer of this.peers.values()) {
      peer.nanoSocket.close()
    }
  }

  telemetryLoop() {
    for (const peer of this.peers.values()) {
      peer.last_telemetry_req = process.hrtime.bigint()
      peer.nanoSocket.sendMessage({
        messageType: constants.MESSAGE_TYPE.TELEMETRY_REQ,
        message: Buffer.from([]),
        extensions: 0
      })
    }
  }

  _getRepresentative({ account, peerAddress }) {
    const foundRep = this.representatives.get(account)
    if (foundRep) {
      return foundRep
    }

    log(`found new representative ${account}, at ${peerAddress}`)
    const rep = new NanoRepresentative(account)
    this.representatives.set(account, rep)
    return rep
  }

  handleKeepalive = (body) => {
    for (let i = 0; i < 8; i++) {
      const peerPtr = i * 18
      const peer = body.subarray(peerPtr, peerPtr + 18)
      const address = peer.subarray(0, 16)
      if (this.peers.has(peer.toString('binary'))) continue
      if (address.equals(constants.SELF_ADDRESS)) continue
      this.connect(peer)
    }
  }

  processElection(blockHash) {
    if (this.elections[blockHash] === undefined) return
    const electionEntry = this.elections[blockHash]
    if (electionEntry.state == 4) return
    // 500000n is a placeholder 67% trended weight
    if (electionEntry.voters.length >= 7462686n) {
      electionEntry.state = 4
    }
  }

  processInactiveElection(blockHash) {
    if (this.inactiveElections[blockHash] === undefined) return
    const electionEntry = this.inactiveElections[blockHash]

    // 500000n is a placeholder 10% trended weight
    if (electionEntry.voters.length >= 10 && electionEntry.voters.length >= 500000n) {
      delete this.inactiveElections[blockHash]
      this.elections[blockHash] = {
        voters: electionEntry.voters,
        votingWeight: electionEntry.votingWeight,
        state: 0,
        requestCount: 0,
        started: Date.now()
      }

      this.processElection(blockHash)
    }
  }

  processVote({ blockHash, representative }) {
    const hasElection = this.elections[blockHash] !== undefined
    // isPrinciple shall be set to true if representative weight is over 0.1% of trended weight.
    const isPrinciple = true
    if (hasElection) {
      const electionEntry = this.elections[blockHash]
      if (electionEntry.voters.includes(representative)) return
      electionEntry.voters.push(representative)
      // 5000n is a placeholder voting weight until weights are implemented
      electionEntry.votingWeight += 5000n

      this.processElection(blockHash)
    } else if (isPrinciple) {
      if (this.inactiveElections[blockHash] === undefined) {
        this.inactiveElections[blockHash] = {
          voters: [],
          votingWeight: 0n
        }
      }
      const electionEntry = this.inactiveElections[blockHash]
      if (electionEntry.voters.includes(representative)) return
      electionEntry.voters.push(representative)
      // 5000n is a placeholder voting weight until weights are implemented
      electionEntry.votingWeight += 5000n

      this.processInactiveElection(blockHash)
    }
  }

  onVote({ vote, peerAddress }) {
    const repAddress = vote.account.toString('hex')
    const representative = this._getRepresentative({
      account: repAddress,
      peerAddress
    })

    if (vote.isValid) {
      representative.votes += 1
      representative.last_vote = process.hrtime.bigint()
      for (const hash of vote.hashList) {
        this.processVote({ blockHash: hash, representative: vote.account })
      }
    } else {
      log(`invalid vote received from ${peerAddress}, rep: ${repAddress}`)
    }
  }

  publish(block, peerCount = 8) {
    const shuffled = Array.from(this.peers.values())
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value)
    const size = Math.max(peerCount, shuffled.length)
    const selected = shuffled.slice(0, size)

    for (const peer of selected) {
      peer.nanoSocket.sendMessage({
        messageType: constants.MESSAGE_TYPE.PUBLISH,
        message: block,
        extensions: 0x600
      })
    }
  }

  onTelemetry({ telemetry, peerAddress, addr }) {
    const result = {
      isPeer: true,
      isRejected: false,
      isLate: false,
      isUnsolicited: false
    }

    const peer = this.peers.get(peerAddress)
    const telemetryNodeId = encodeAddress({
      publicKey: telemetry.node_id,
      prefix: 'node_'
    })

    if (!telemetryNodeId === peer.nanoSocket.connectedNodeId) {
      result.isRejected = true
      result.isPeer = false
      log(`mismatched telemetry & socket node_id (${addr})`)
    }

    if (!peer.last_telemetry_req) {
      result.isRejected = true
      result.isUnsolicited = true
      log(`unsolicited telemetry_ack (${addr})`)
    } else if (process.hrtime.bigint() - peer.last_telemetry_req > 1e10) {
      result.isRejected = true
      result.isLate = true
      log(`late telemetry_ack (${addr})`)
    }

    this.emit('telemetry', { ...telemetry, ...result })

    if (result.isRejected) {
      return
    }

    peer.telemetry = telemetry
    peer.last_telemetry_req = null
  }

  onConnection = (socket) => {
    const nanoSocket = new NanoSocket({ socket, node: this })
    this.setupNanoSocket(nanoSocket)
  }

  listen({ address = '::0', port = this.network.PORT } = {}) {
    this.server = net.createServer(null, this.onConnection)
    this.server.listen(port, address, () => {
      log(`Node Address: ${address}:${port}`)
      this.emit('listening')
    })
  }

  connect(connectionInfo) {
    this.peers.set(connectionInfo.toString('binary'), null)
    log(`opening connection to ${connectionInfo.toString('hex')} (current: ${this.peers.size})`)
    const nanoSocket = new NanoSocket({
      connectionInfo,
      node: this
    })
    this.setupNanoSocket(nanoSocket)
  }

  connectAddress({ address = '127.0.0.1', port = this.network.PORT } = {}) {
    const connectionInfo = encodeConnectionInfo({ address: address, port })
    this.connect(connectionInfo)
  }

  connectDomain({ host = this.network.ADDRESS, port = this.network.PORT } = {}) {
    dns.resolve4(host, (err, addresses) => {
      if (err) return err

      addresses.forEach((address) => {
        this.connectAddress({ address: '::ffff:' + address, port })
      })
    })
  }

  setupNanoSocket = (nanoSocket) => {
    const { peerAddress } = nanoSocket
    const peer = new NanoPeer({ peerAddress, nanoSocket })

    nanoSocket.on('error', (error) => {
      this.emit('error', error)
    })

    nanoSocket.on('handshake', ({ nodeId }) => {
      this.emit('handshake', {
        nodeId,
        peerAddress: nanoSocket.readableAddress
      })
    })

    nanoSocket.on('message', (message) => {
      peer.messages += 1
      this.emit('message', message)
    })

    nanoSocket.on('vote', (vote) => {
      this.emit('vote', vote)
      this.onVote({ vote, peerAddress: nanoSocket.readableAddress })
    })

    nanoSocket.on('telemetry', (telemetry) => {
      this.onTelemetry({ telemetry, peerAddress, addr: nanoSocket.readableAddress })
    })

    nanoSocket.on('represenative', (representative) => {})

    nanoSocket.on('close', () => {
      this.peers.delete(peerAddress)
      log(`closed connection to ${nanoSocket.readableAddress} (current: ${this.peers.size})`)
      nanoSocket.removeAllListeners()
      this.emit('close', peerAddress)
    })

    this.peers.set(peerAddress, peer)
  }
}

export { constants as NanoConstants }

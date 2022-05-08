import EventEmitter from 'events'
import crypto from 'crypto'
import net from 'net'
import debug from 'debug'
import dns from 'dns'

import {
  constants,
  ed25519,
  encodeAddress,
  encodeConnectionInfo,
  getState,
  STATE_NAMES,
  rawToXNO
} from '#common'

import NanoSocket from './nano-socket.js'

const TEST_WEIGHTS = {
  [Buffer.from('B70891DB12BA08E1BB41258BF68BE061E6A202B9123F23946E4A78B54FDBB0B1', 'hex').toString('binary')]: 10327380790000000000000004088401736465n,
  [Buffer.from('4A1AD31E21E709E69E8EDC00D4462471E0D639BF6895193C8139F7852F50A031', 'hex').toString('binary')]: 10327380790000000000000004102753727373n,
  [Buffer.from('B51B53342D0294C6C9EC20F0856082922B5EF04FDDC4585B62BC19AFBCB35DEE', 'hex').toString('binary')]: 14213198050000000000000003992592021377n,
  [Buffer.from('269E432CCD554B7B948EE53029C88E063D153A0FDC565E6848528BB7FC1A7884', 'hex').toString('binary')]: 1000001000000000000000000000000000000n,
  [Buffer.from('62A9AE9CF8E91B480CB9D4107CBEE3C63918772D3FB8B687D2B20C0D9C59090F', 'hex').toString('binary')]: 11324829100000000000000003969586881448n,
  [Buffer.from('36AD606FDB432B72BD3E9F01C5B59E58537D3C39A1F4D874B8BA7A8184D39087', 'hex').toString('binary')]: 501100000000000000000000000000000000n,
  [Buffer.from('620A942C3CCD8CFEABD538F19C6D99F90CD97929CA39CB35ACE42D8620194E37', 'hex').toString('binary')]: 9326226788000000000006158749262030474n,
  [Buffer.from('259A47DE59854777159F1781C7FD44DF0775671E502AB0CFDBCBC23718223117', 'hex').toString('binary')]: 15326429709999999999960481262220025769n,
  [Buffer.from('7118441BF691B8F79F51EF7D664E0A08FAD930268E6846BCF59CAAAFAF24BDB0', 'hex').toString('binary')]: 9327380790000000000000004023915260534n,
  [Buffer.from('D2BD39F17AA2640D4EC489EC95B76D4E2A5DC8B9ACAAC9B29DC9B9F4DAF7DC7E', 'hex').toString('binary')]: 10327380790000000000000004066108950938n,
  [Buffer.from('472A504C229DDC8AE5CF8BAFEC473046C1B0813A36E1FAE8E526EC2775E67430', 'hex').toString('binary')]: 62310944584759999999977667772640744320n
}

const TEST_TRENDED = 93001409827999999999966668317374245255n

const TEST_CONFIRMATION_QUORUM = (TEST_TRENDED * 67n) / 100n

const TEST_VOTE_HINT = TEST_TRENDED / 10n

const TEST_PRINCIPLE_WEIGHT = TEST_TRENDED / 1000n

const log = debug('node')

function logElection(label, election, blockHash) {
  const voters = []

  for (const voter of election.voters) {
    voters.push(
      encodeAddress({
        publicKey: Buffer.from(voter, 'binary')
      })
    )
  }

  const started = new Date(election.started).toTimeString()
  const confirmed = (election.confirmed && new Date(election.confirmed).toTimeString()) || 'NOT CONFIRMED'

  console.log(
    label + '\n',
    ' - Block Hash: ' + blockHash.toString('hex').toUpperCase() + '\n',
    ' - Voters:\n      - ' + voters.join('\n      - ') + '\n',
    ' - Voting Weight: ' + rawToXNO(election.votingWeight) + '\n',
    ' - Election Started At: ' + started + '\n',
    ' - Confirmed At: ' + confirmed + '\n',
    ' - Election State: ' + STATE_NAMES[getState(election)] + '\n'
  )
}

function logInactiveElection(label, election, blockHash) {
  const voters = []

  for (const voter of election.voters) {
    voters.push(
      encodeAddress({
        publicKey: Buffer.from(voter, 'binary')
      })
    )
  }

  console.log(
    label + '\n',
    ' - Block Hash: ' + blockHash.toString('hex').toUpperCase() + '\n',
    ' - Voters:\n      - ' + voters.join('\n      - ') + '\n',
    ' - Voting Weight: ' + rawToXNO(election.votingWeight) + '\n'
  )
}

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

    // [BlockHash]: { voters: [ Voting Account(s) ], votingWeight: Total Voting Weight, confirmed: 0 (Unconfirmed) >= 1 (Confirmed), requestCount: Amount of times Node has requested vote for this Election, started: Time Election Started }
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

    log(`found new representative ${Buffer.from(account, 'binary').toString('hex')}, at ${peerAddress}`)
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
    if (electionEntry.confirmed !== 0) return
    if (electionEntry.votingWeight >= TEST_CONFIRMATION_QUORUM) {
      electionEntry.confirmed = Date.now()
      logElection('New Confirmation', electionEntry, blockHash)
    }
  }

  processInactiveElection(blockHash) {
    if (this.inactiveElections[blockHash] === undefined) return
    const electionEntry = this.inactiveElections[blockHash]

    if (electionEntry.voters.length >= 10 && electionEntry.votingWeight >= TEST_VOTE_HINT) {
      delete this.inactiveElections[blockHash]
      this.elections[blockHash] = {
        voters: electionEntry.voters,
        votingWeight: electionEntry.votingWeight,
        confirmed: 0,
        requestCount: 0,
        started: Date.now()
      }

      logElection('New Election', this.elections[blockHash], blockHash)

      this.processElection(blockHash)
    }
  }

  processVote({ blockHash, representative }) {
    const hasElection = this.elections[blockHash] !== undefined
    const represenativeWeight = TEST_WEIGHTS[representative]

    const isPrinciple = represenativeWeight >= TEST_PRINCIPLE_WEIGHT
    if (hasElection) {
      const electionEntry = this.elections[blockHash]
      if (electionEntry.voters.includes(representative)) return
      electionEntry.voters.push(representative)
      electionEntry.votingWeight += represenativeWeight

      logElection('Proccesing Active Election', electionEntry, blockHash)

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
      electionEntry.votingWeight += represenativeWeight

      logInactiveElection('Proccesing Inactive Election', electionEntry, blockHash)

      this.processInactiveElection(blockHash)
    }
  }

  processElection(blockHash) {
    if (this.elections[blockHash] === undefined) return
    const electionEntry = this.elections[blockHash]
    if (electionEntry.confirmed !== 0) return
    if (electionEntry.votingWeight >= TEST_CONFIRMATION_QUORUM) {
      electionEntry.confirmed = Date.now()
      logElection('New Confirmation', electionEntry, blockHash)
    }
  }

  processInactiveElection(blockHash) {
    if (this.inactiveElections[blockHash] === undefined) return
    const electionEntry = this.inactiveElections[blockHash]

    if (electionEntry.voters.length >= 10 && electionEntry.votingWeight >= TEST_VOTE_HINT) {
      delete this.inactiveElections[blockHash]
      this.elections[blockHash] = {
        voters: electionEntry.voters,
        votingWeight: electionEntry.votingWeight,
        confirmed: 0,
        requestCount: 0,
        started: Date.now()
      }

      logElection('New Election', this.elections[blockHash], blockHash)

      this.processElection(blockHash)
    }
  }

  processVote({ blockHash, representative }) {
    const hasElection = this.elections[blockHash] !== undefined
    const represenativeWeight = TEST_WEIGHTS[representative]

    const isPrinciple = represenativeWeight >= TEST_PRINCIPLE_WEIGHT
    if (hasElection) {
      const electionEntry = this.elections[blockHash]
      if (electionEntry.voters.includes(representative)) return
      electionEntry.voters.push(representative)
      electionEntry.votingWeight += represenativeWeight

      logElection('Proccesing Active Election', electionEntry, blockHash)

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
      electionEntry.votingWeight += represenativeWeight

      logInactiveElection('Proccesing Inactive Election', electionEntry, blockHash)

      this.processInactiveElection(blockHash)
    }
  }

  onVote({ vote, peerAddress }) {
    const repAddress = vote.account.toString('binary')

    if (vote.isValid) {
      const representative = this._getRepresentative({
        account: repAddress,
        peerAddress
      })

      representative.votes += 1
      representative.last_vote = process.hrtime.bigint()
      if (TEST_WEIGHTS[repAddress] === undefined) return
      for (const hash of vote.hashList) {
        this.processVote({ blockHash: hash, representative: repAddress })
      }
    } else {
      log(`invalid vote received from ${peerAddress}, rep: ${vote.account.toString('hex')}`)
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

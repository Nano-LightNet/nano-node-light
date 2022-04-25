import EventEmitter from 'events'
import crypto from 'crypto'
import net from 'net'
import debug from 'debug'

import {
  encodeMessage,
  constants,
  decodeNodeHandshake,
  decodeVote,
  ed25519,
  decodeTelemetry
} from '#common'

import NanoStream from '#common/stream.js'

const log = debug('socket')

const currentLNetVersion = 0x01
const minLNetVersion = 0x01

export default class NanoSocket extends EventEmitter {
  constructor({ address, port, node, socket }) {
    super()

    this.isIncoming = Boolean(socket)
    this.node = node
    this.cookie = crypto.randomBytes(32)
    this.cookie[0] = currentLNetVersion
    this.cookie[1] = minLNetVersion
    this.connectedNodeId = null
    this.socketType = 0 // 0 = Origin Network, 1 = Light Network

    if (this.isIncoming) {
      log(`Incoming socket status: ${socket.readyState}`)
      this.socket = socket
      const { remoteAddress, remotePort } = socket
      this.peerAddress = `[${remoteAddress}]:${remotePort}`
    } else {
      const options = {
        host: address,
        port: port
      }
      this.peerAddress = `[${address}]:${port}`
      this.socket = net.createConnection(options, this.onConnection)
    }

    const stream = (this.stream = new NanoStream(this.node.network.ID))

    this.socket.on('data', (data) => stream.push(data))
    stream.on('message', (msg) => {
      this.emit('message', msg)
      this.handleMessage(msg)
    })

    this.socket.on('close', () => {
      this.emit('close')
      this.socket.removeAllListeners('data')
      this.socket.removeAllListeners('close')
      this.socket.removeAllListeners('error')
    })

    this.socket.on('error', (error) => {
      this.emit('error', error)
    })
  }

  onConnection = () => {
    const NodeIDMessage = encodeMessage({
      message: this.cookie,
      messageType: constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE,
      extensions: 1 | 0x8000,
      network: this.node.network.ID
    })

    this.socket.write(NodeIDMessage)
  }

  sendMessage = ({ messageType, message, extensions }) => {
    log(
      `sending ${constants.MESSAGE_TYPE_NAME[messageType]} to ${this.peerAddress}`
    )
    const encoded = encodeMessage({
      message,
      messageType,
      extensions,
      network: this.node.network.ID
    })
    this.socket.write(encoded)
  }

  close = () => this.socket.destroy()

  keepalive = (peerList) => {
    this.sendMessage({
      messageType: constants.MESSAGE_TYPE.KEEPALIVE,
      message: Buffer.concat(peerList, 144),
      extensions: 0
    })
  }

  handleHandshake = ({ body, extensions }) => {
    const handshake = decodeNodeHandshake({ packet: body, extensions })
    let responseData = Buffer.from([])
    let queryData = Buffer.from([])
    let ext = 0

    if (handshake.query && !this.handshakeResponded) {
      this.handshakeResponded = true
      const Signature = ed25519.sign(handshake.query, this.node.nodeKey.secret)
      responseData = Buffer.concat([this.node.nodeKey.public, Signature])
      ext |= 2
    }

    if (handshake.response && !this.connectedNodeId) {
      const { account, signature } = handshake.response
      const validation = ed25519.verify(signature, this.cookie, account)
      if (!validation) {
        log(`received invalid handshake signature from ${this.peerAddress}`)
        return
      }

      this.connectedNodeId = account
      this.emit('handshake', { nodeId: account })
    } else if (!this.connectedNodeId) {
      ext |= 1
      queryData = this.cookie
    }

    if (ext !== 0) {
      this.sendMessage({
        messageType: constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE,
        message: Buffer.concat([queryData, responseData]),
        extensions: ext
      })
    }
  }

  handleKeepalive = (body) => {
    const peer_count = Math.floor(body.length / 18)
    const peers = []
    for (let i = 0; i < peer_count; i++) {
      const peerPtr = i * 18
      const peer = body.subarray(peerPtr, peerPtr + 18)
      const address = peer.subarray(0, 16)
      if (!address.equals(constants.SELF_ADDRESS)) {
        peers.push(peer)
      }
    }
    this.emit('peers', peers)
  }

  handleVote = ({ body, extensions }) => {
    const voteInfo = decodeVote({ body, extensions })
    this.emit('vote', voteInfo)
  }

  handleTelemetry = ({ body, extensions }) => {
    if (body.length < 194) return
    const telemetryInfo = decodeTelemetry({ body, extensions })
    this.emit('telemetry', {
      ...telemetryInfo,
      address: this.socket.remoteAddress,
      port: this.socket.remotePort
    })
  }

  handleMessage = (msgInfo) => {
    const { body, extensions, message_type } = msgInfo

    log(
      `Received ${constants.MESSAGE_TYPE_NAME[message_type]} from ${this.peerAddress}`
    )

    switch (message_type) {
      case constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE: {
        this.handleHandshake({ body, extensions })
        break
      }

      case constants.MESSAGE_TYPE.KEEPALIVE: {
        this.handleKeepalive(body)
        break
      }

      case constants.MESSAGE_TYPE.CONFIRM_ACK: {
        this.handleVote({ body, extensions })
        break
      }

      case constants.MESSAGE_TYPE.TELEMETRY_ACK: {
        this.handleTelemetry({ body, extensions })
        break
      }

      default: {
        // log warning
      }
    }
  }
}

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
  decodeTelemetry,
  encodeConnectionInfo,
  decodeConnectionInfo
} from '#common'

import NanoStream from '#common/stream.js'

const log = debug('socket')

export default class NanoSocket extends EventEmitter {
  constructor({ connectionInfo, node, socket }) {
    super()

    this.isIncoming = Boolean(socket)
    this.node = node
    this.cookie = crypto.randomBytes(32)
    this.connectedNodeId = null

    if (this.isIncoming) {
      log(`Incoming socket status: ${socket.readyState}`)
      this.socket = socket
      const { remoteAddress, remotePort } = socket
      this.connectionInfo = encodeConnectionInfo({
        address: remoteAddress,
        port: remotePort
      })

      this.readableAddress = `[${remoteAddress}]:${remotePort}`
    } else {
      this.connectionInfo = connectionInfo
      const connection = decodeConnectionInfo(connectionInfo)
      const options = {
        host: connection.address,
        port: connection.port
      }
      this.readableAddress = `[${connection.address}]:${connection.port}`
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
      this.socket.removeAllListeners()
    })

    this.socket.on('error', (error) => {
      this.emit('error', error)
    })
  }

  onConnection = () => {
    const NodeIDMessage = encodeMessage({
      message: this.cookie,
      messageType: constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE,
      extensions: 1,
      network: this.node.network.ID
    })

    this.socket.write(NodeIDMessage)
  }

  sendMessage = ({ messageType, message, extensions, onSent }) => {
    log(
      `sending ${constants.MESSAGE_TYPE_NAME[messageType]} to ${this.readableAddress}`
    )
    const encoded = encodeMessage({
      message,
      messageType,
      extensions,
      network: this.node.network.ID
    })
    return this.socket.write(encoded, null, onSent)
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
      const Signature = ed25519.sign(
        handshake.query,
        this.node.nodeKey.secret,
        this.node.nodeKey.public
      )
      responseData = Buffer.concat([this.node.nodeKey.public, Signature])
      ext |= 2
    }

    if (handshake.response && !this.connectedNodeId) {
      const { account, signature } = handshake.response
      const validation = ed25519.verify(signature, this.cookie, account)
      if (!validation) {
        log(`received invalid handshake signature from ${this.readableAddress}`)
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

  handleVote = ({ body, extensions }) => {
    const voteInfo = decodeVote({ body, extensions })
    if (voteInfo.isValid !== true) return
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
      `Received ${constants.MESSAGE_TYPE_NAME[message_type]} from ${this.readableAddress}`
    )

    switch (message_type) {
      case constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE: {
        this.handleHandshake({ body, extensions })
        break
      }

      case constants.MESSAGE_TYPE.KEEPALIVE: {
        this.node.handleKeepalive(body)
        break
      }

      case constants.MESSAGE_TYPE.CONFIRM_ACK: {
        this.handleVote({ body, extensions })
        break
      }

      case constants.MESSAGE_TYPE.TELEMETRY_REQ: {
        this.sendMessage({
          message: Buffer.alloc(0),
          messageType: constants.MESSAGE_TYPE.TELEMETRY_ACK,
          extensions: 0
        })
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

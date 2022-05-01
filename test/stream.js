/* global describe it */
import chai from 'chai'
import bytes from 'chai-bytes'

import NanoStream from '#common/stream.js'
import * as constants from '#common/constants.js'

chai.use(bytes)
const { expect } = chai

const waitForMessage = ({ stream, count = 1 }) =>
  new Promise((resolve, reject) => {
    const msgs = []
    stream.on('message', (msg) => {
      msgs.push(msg)
      if (msgs.length === count) {
        resolve(msgs)
      }
    })
  })

describe('Nano Stream', function () {
  it('process handshake message, one chunk', async () => {
    const stream = new NanoStream(constants.NETWORK.BETA.ID)

    const msgs_p = waitForMessage({ stream })

    const header = '52421212120a0300'
    const body =
      'c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401'

    stream.push(Buffer.from(header + body, 'hex'))

    const msgs = await msgs_p
    const msg = msgs[0]

    expect(msg.message_type).to.equal(constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE)
    expect(msg.version).to.equal(18)
    expect(msg.extensions).to.equal(3)
    expect(msg.body).to.equalBytes(Buffer.from(body, 'hex'))
  })

  it('process handshake message, two random chunks', async () => {
    const stream = new NanoStream(constants.NETWORK.BETA.ID)

    const msgs_p = waitForMessage({ stream })

    const header = '52421212120a0300'
    const body =
      'c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401'

    const full = header + body
    const chunks = []
    const range = full.length - 6
    const index = Math.floor((Math.random() * range) / 2) * 2
    chunks.push(full.substring(0, index))
    chunks.push(full.substring(index))
    for (const chunk of chunks) {
      stream.push(Buffer.from(chunk, 'hex'))
    }

    const msgs = await msgs_p
    const msg = msgs[0]

    expect(msg.message_type).to.equal(constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE)
    expect(msg.version).to.equal(18)
    expect(msg.extensions).to.equal(3)
    expect(msg.body).to.equalBytes(Buffer.from(body, 'hex'))
  })

  it('process handshake message, three chunks', async () => {
    const stream = new NanoStream(constants.NETWORK.BETA.ID)

    const msgs_p = waitForMessage({ stream })

    const body =
      'c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401'

    stream.push(Buffer.from('52421212', 'hex'))
    stream.push(
      Buffer.from(
        '120a0300c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f895028',
        'hex'
      )
    )
    stream.push(
      Buffer.from(
        '5ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401',
        'hex'
      )
    )

    const msgs = await msgs_p
    const msg = msgs[0]

    expect(msg.message_type).to.equal(constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE)
    expect(msg.version).to.equal(18)
    expect(msg.extensions).to.equal(3)
    expect(msg.body).to.equalBytes(Buffer.from(body, 'hex'))
  })

  it('process multiple handshake messages', async () => {
    const stream = new NanoStream(constants.NETWORK.BETA.ID)

    const msgs_p = waitForMessage({ stream })

    const body =
      'c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401'

    stream.push(Buffer.from('52421212', 'hex'))
    stream.push(
      Buffer.from(
        '120a0300c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f895028',
        'hex'
      )
    )
    stream.push(
      Buffer.from(
        '5ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c11140152421212',
        'hex'
      )
    )
    stream.push(
      Buffer.from(
        '120a0300c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401',
        'hex'
      )
    )

    const msgs = await msgs_p
    const msg_a = msgs[0]

    expect(msg_a.message_type).to.equal(
      constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE
    )
    expect(msg_a.version).to.equal(18)
    expect(msg_a.extensions).to.equal(3)
    expect(msg_a.body).to.equalBytes(Buffer.from(body, 'hex'))

    const msg_b = msgs[1]

    expect(msg_b.message_type).to.equal(
      constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE
    )
    expect(msg_b.version).to.equal(18)
    expect(msg_b.extensions).to.equal(3)
    expect(msg_b.body).to.equalBytes(Buffer.from(body, 'hex'))
  })
})

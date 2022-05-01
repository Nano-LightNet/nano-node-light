/* global describe it */
import chai from 'chai'
import bytes from 'chai-bytes'

import NanoStream from '#common/stream.js'
import * as constants from '#common/constants.js'

chai.use(bytes)
const { expect } = chai

const waitForMessage = (stream) => new Promise((resolve, reject) => {
  stream.on('message', (msg) => {
    resolve(msg)
  })
})

describe('Nano Stream', function () {
  it('process handshake message', async () => {
    const stream = new NanoStream(constants.NETWORK.BETA.ID)

    const msg_p = waitForMessage(stream)

    const header = '52421212120a0300'
    const body = 'c73848b9227ff859b7a6c793685558d9d5b14f487b7302bfc7bd6e187f8950285ae7ed78c5e75f96e08cd5bb22ecdd09cab40332901a41ef7877ba0cf823fc3be8f67856d89165840280e71b10e62facdbddff161ac86fa47cd59dc7c2ced033d0f55584443914b9cf74ce6de9af04cd215c95046a7a450d3403fb263c111401'

    stream.push(Buffer.from(header + body, 'hex'))

    const msg = await msg_p

    expect(msg.message_type).to.equal(constants.MESSAGE_TYPE.NODE_ID_HANDSHAKE)
    expect(msg.version).to.equal(18)
    expect(msg.extensions).to.equal(3)
    expect(msg.body).to.equalBytes(Buffer.from(body, 'hex'))
  })
})

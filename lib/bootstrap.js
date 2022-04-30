import net from 'net'
import EventEmitter from 'events'

import {
  encodeMessage
} from '#common'

const blockSizes = {
  0x00: 0, // Invalid
  0x01: 0, // Not A Block (NaB)
  0x02: 152, // Send (Legacy)
  0x03: 136, // Receive (Legacy)
  0x04: 168, // Open (Legacy)
  0x05: 136, // Change (Legacy)
  0x06: 216 // State
}

export class BulkPull extends EventEmitter {
  constructor(host, port) {
    super()

    this.destroyed = false

    this.state = {
      block: null,
      blockType: null,
      expectedSize: null,
      size: 0,
      addPtr: null
    }

    this.socket = net.createConnection({
        host,
        port
      },
      () => {
        this.emit('open')
      }
    )
    this.socket.on('error', () => {
      this.emit('close')
    })
    this.socket.on('close', () => {
      this.emit('close')
    })
    this.socket.on('data', (data) => {
      this.handleMsg(data)
    })
  }
  defaultState() {
    this.state.block = null
    this.state.blockType = null
    this.state.expectedSize = null
    this.state.addPtr = null
    this.state.size = 0
  }
  close() {
    this.client.destroy()
    this.destroyed = true
  }
  handleMsg(data) {
    if (this.destroyed) return
    const state = this.state

    let ptr = 0;
    const length = data.length
    for (;;) {
      if (state.blockType) {
        if (!state.addPtr) {
          state.addPtr = true;
          ptr++;
        }
        const bodyPtr = ptr + state.expectedSize - state.size
        const body = data.subarray(ptr, bodyPtr)
        state.block.set(body, state.size)
        state.size += body.length

        if (state.size == state.expectedSize) {
          const msgInfo = Object.assign({}, state)
          delete msgInfo.size
          delete msgInfo.expectedSize
          delete msgInfo.addPtr

          this.emit("block", msgInfo)
          this.defaultState()
        }

        ptr += body.length
      } else {
        const blockType = data[ptr]
        state.blockType = blockType
        const blockSize = blockSizes[blockType]
        if (blockType == undefined) {
          this.close()
          break
        }
        state.expectedSize = blockSize
        state.block = Buffer.alloc(blockSize)
        state.addPtr = false;
      }
      if (ptr >= length) break;
    }
  }
}

export class FrontierReq extends EventEmitter {
  constructor(host, port) {
    super()

    this.state = {
      current: Buffer.alloc(64),
      size: 0
    }

    this.socket = net.createConnection({
        host,
        port
      },
      () => {
        this.emit('open')
      }
    )
    this.socket.on('error', () => {
      this.emit('close')
    })
    this.socket.on('close', () => {
      this.emit('close')
    })
    this.socket.on('data', (data) => {
      this.handleMsg(data)
    })
  }
  defaultState() {
    this.size = 0
  }
  close() {
    this.client.destroy()
  }
  handleMsg(data) {
    if (this.destroyed) return
    const state = this.state

    let ptr = 0;
    const length = data.length
    for (;;) {
      const bodyPtr = ptr + 64 - state.size
      const body = data.subarray(ptr, bodyPtr)
      state.current.set(body, state.size)
      state.size += body.length

      if (state.size == 64) {
        const Account = Buffer.alloc(32)
        const Frontier = Buffer.alloc(32)

        state.current.copy(Account, 0, 0);
        state.current.copy(Frontier, 0, 32);
        
        this.emit("frontier", {
          Account,
          Frontier
        })
        this.defaultState()
      }

      ptr += body.length
    }
  }
}
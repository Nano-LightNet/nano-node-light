import lmdb from 'node-lmdb'
import fs from 'fs'
import path from 'path'

const blockSizes = {
  0x02: 152, // Send (Legacy)
  0x03: 136, // Receive (Legacy)
  0x04: 168, // Open (Legacy)
  0x05: 136, // Change (Legacy)
  0x06: 216 // State
}

const sidebandSizes = {
  0x02: 80, // Send (Legacy)
  0x03: 96, // Receive (Legacy)
  0x04: 56, // Open (Legacy)
  0x05: 96, // Change (Legacy)
  0x06: 49 // State
}

function decodeSideband(blockType, sideband) {
  switch (blockType) {
      case 0x02: {
        const Successor = sideband.subarray(0, 32)
        const Account = sideband.subarray(32, 64)
        const Height = sideband.readBigUInt64BE(64)
        const Timestamp = sideband.readBigUInt64BE(72)

        return {
          Successor,
          Account,
          Height,
          Timestamp
        }
      }
      case 0x03: {
        const Successor = sideband.subarray(0, 32)
        const Account = sideband.subarray(32, 64)
        const Height = sideband.readBigUInt64BE(64)
        const Balance = (sideband.readBigUInt64BE(72) << 64n) | sideband.readBigUInt64BE(80)
        const Timestamp = sideband.readBigUInt64BE(88)

        return {
          Successor,
          Account,
          Height,
          Balance,
          Timestamp
        }
      }
      case 0x04: {
        const Successor = sideband.subarray(0, 32)
        const Balance = (sideband.readBigUInt64BE(32) << 64n) | sideband.readBigUInt64BE(40)
        const Timestamp = sideband.readBigUInt64BE(48)

        return {
          Successor,
          Height: 1n,
          Balance,
          Timestamp
        }
      }
      case 0x05: {
        const Successor = sideband.subarray(0, 32)
        const Account = sideband.subarray(32, 64)
        const Height = sideband.readBigUInt64BE(64)
        const Balance = (sideband.readBigUInt64BE(72) << 64n) | sideband.readBigUInt64BE(80)
        const Timestamp = sideband.readBigUInt64BE(88)

        return {
          Successor,
          Account,
          Height,
          Balance,
          Timestamp
        }
      }
      case 0x06: {
        const Successor = sideband.subarray(0, 32)
        const Height = sideband.readBigUInt64BE(32)
        const Timestamp = sideband.readBigUInt64BE(40)

        const isSend = (sideband[48] & 0x80 && true) || false
        const isReceive = (sideband[48] & 0x40 && true) || false
        const isEpoch = (sideband[48] & 0x20 && true) || false
        const EpochVersion = (sideband[48] & 0x1f)

        return {
          Successor,
          Height,
          Timestamp,
          isSend,
          isReceive,
          isEpoch,
          EpochVersion
        }
      }
  }
  return null
}

class Database {
  constructor(folder = path.join(process.cwd(), 'node')) {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder)
    }

    this.env = new lmdb.Env()
    this.env.open({
        path: folder + '/ledger',
        maxDbs: 100
    })

    this.blocksTable = this.env.openDbi({
        name: 'blocks',
        create: true
    })
  }

  _getBlock(txn, blockHash) {
    const block = txn.getBinary(this.blocksTable, blockHash)

    if (block == null) {
      return null
    } else {
      const BlockType = block[0]
      const BlockSize = blockSizes[BlockType]
      if (!BlockSize) {
        return null
      }
      const Block = block.subarray(1, 1 + BlockSize)
      const Sideband = block.subarray(1 + BlockSize, 1 + BlockSize + sidebandSizes[BlockType])

      return {
        Block,
        Sideband: decodeSideband(BlockType, Sideband)
      }
    }
  }

  getBlock(blockHash) {
    const txn = this.env.beginTxn({ readOnly: true })
    const result = this._getBlock(txn, blockHash)
    txn.abort()

    return result
  }
}

export default Database

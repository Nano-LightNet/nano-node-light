import debug from 'debug'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { BulkPull } from '#lib/bootstrap.js'
import { constants } from '#common'

const argv = yargs(hideBin(process.argv)).argv

const log = debug('bootstrap')
debug.enable('*')

if (!argv.account) {
  log('missing --account')
  process.exit()
}

const getNetwork = (network = 'live') => {
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
const client = new BulkPull({
  host: argv.host || network.ADDRESS,
  port: argv.post || network.PORT,
  network
})

client.on('open', () => {
  log('open')
})

client.on('error', (error) => {
  log(error)
})

client.on('close', () => {
  log('close')
})

let count = 0
client.on('block', (entry) => {
  log(count++)
  log(entry)
})

client.on('end', () => {
  log('end')
})

const account = Buffer.from(argv.account, 'hex')
client.request({ start: account, count: argv.count })

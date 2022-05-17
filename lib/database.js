const lmdb = require('node-lmdb')
const fs = require('fs')
const path = require('path')

class Database {
  constructor(folder = path.join(process.cwd(), "node")) {
    if (!fs.existsSync(folder)){
        fs.mkdirSync(folder);
    }

    this.env = new lmdb.Env();
    this.env.open({
        path: folder + "/ledger",
        maxDbs: 100
    })
  }
}

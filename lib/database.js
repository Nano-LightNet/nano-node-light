import lmdb from 'node-lmdb'
import fs from 'fs'
import path from 'path'

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

export default Database

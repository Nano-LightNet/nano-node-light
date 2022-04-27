export const MAGIC_NUMBER = 'R'.charCodeAt(0)

export const SELF_ADDRESS = Buffer.alloc(16, 0)

export const MESSAGE_TYPE = {
  INVALID: 0x00,
  NAT: 0x01,
  KEEPALIVE: 0x02,
  PUBLISH: 0x03,
  CONFIRM_REQ: 0x04,
  CONFIRM_ACK: 0x05,
  BULK_PULL: 0x06,
  FRONTIER_REQ: 0x08,
  NODE_ID_HANDSHAKE: 0x0a,
  BULK_PULL_ACCOUNT: 0x0b,
  TELEMETRY_REQ: 0x0c,
  TELEMETRY_ACK: 0x0d,
  PROTOCOL_UPGRADE: 0x1f
}
export const MESSAGE_TYPE_NAME = {
  [MESSAGE_TYPE.INVALID]: 'Invalid',
  [MESSAGE_TYPE.NAT]: 'NaT',
  [MESSAGE_TYPE.KEEPALIVE]: 'KeepAlive',
  [MESSAGE_TYPE.PUBLISH]: 'Publish',
  [MESSAGE_TYPE.CONFIRM_REQ]: 'ConfirmReq',
  [MESSAGE_TYPE.CONFIRM_ACK]: 'ConfirmAck',
  [MESSAGE_TYPE.BULK_PULL]: 'BulkPull',
  [MESSAGE_TYPE.FRONTIER_REQ]: 'FrontierReq',
  [MESSAGE_TYPE.NODE_ID_HANDSHAKE]: 'NodeIDHandshake',
  [MESSAGE_TYPE.BULK_PULL_ACCOUNT]: 'BulkPullAccount',
  [MESSAGE_TYPE.TELEMETRY_REQ]: 'TelemetryReq',
  [MESSAGE_TYPE.TELEMETRY_ACK]: 'TelemetryAck',
  [MESSAGE_TYPE.PROTOCOL_UPGRADE]: 'ProtocolUpgrade'
}

export const LNET_MESSAGE_TYPE = {
  INVALID: 0x00,
  NODE_ID_HANDSHAKE: 0x01,
  NODE_ID_ACK: 0x02
}
export const LNET_MESSAGE_TYPE_NAME = {
  [LNET_MESSAGE_TYPE.INVALID]: 'Invalid',
  [LNET_MESSAGE_TYPE.NODE_ID_HANDSHAKE]: 'NodeIDHandshake',
  [LNET_MESSAGE_TYPE.NODE_ID_ACK]: 'NodeIDAck',
}

export const NETWORK = {
  LIVE: {
    ID: 'C'.charCodeAt(0),
    ADDRESS: 'peering.nano.org',
    PORT: 7075,
    TELEMETRY_CACHE_CUTOFF: 6e10 // 60 seconds
  },
  BETA: {
    ID: 'B'.charCodeAt(0),
    ADDRESS: 'peering-beta.nano.org',
    PORT: 54000,
    TELEMETRY_CACHE_CUTOFF: 15e9 // 15 seconds
  },
  TEST: {
    ID: 'X'.charCodeAt(0),
    ADDRESS: 'peering-test.nano.org',
    PORT: 17075,
    TELEMETRY_CACHE_CUTOFF: 6e10 // 60 seconds
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { NetClient } from '../src/net/client.js'

test('主动退房后，旧连接的关闭事件不影响大厅的新连接', async (t) => {
  const originalWebSocket = globalThis.WebSocket
  const originalLocation = globalThis.location
  class Socket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    readyState = Socket.CONNECTING

    open() {
      this.readyState = Socket.OPEN
      this.dispatchEvent(new Event('open'))
    }

    close() {
      this.readyState = 2
    }

    finishClose() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  globalThis.WebSocket = Socket
  globalThis.location = { protocol: 'http:', host: 'localhost' }
  t.after(() => {
    globalThis.WebSocket = originalWebSocket
    if (originalLocation) globalThis.location = originalLocation
    else delete globalThis.location
  })

  const client = new NetClient()
  let disconnects = 0
  client.on('disconnect', () => disconnects++)
  const first = client.connect()
  const room = client.ws
  room.open()
  await first

  client.close()
  const second = client.connect()
  const lobby = client.ws
  lobby.open()
  await second
  room.finishClose()

  assert.equal(disconnects, 0)
  assert.equal(client.ws, lobby)
  lobby.finishClose()
  assert.equal(disconnects, 1)
  assert.equal(client.ws, null)
})

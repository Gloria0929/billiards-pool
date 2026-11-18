import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'

test('开局后房主离开，电脑代打，原房主重新连接后恢复座位和球局', { timeout: 10000 }, async (t) => {
  process.env.WS_PORT = '0'
  const { server, wss } = await import('../server/index.js')
  if (!server.listening) await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}/ws`
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate()
    await new Promise((resolve) => server.close(resolve))
  })

  async function connect() {
    const socket = new WebSocket(url)
    const messages = []
    socket.on('message', (data) => messages.push(JSON.parse(data)))
    await once(socket, 'open')
    return {
      socket,
      send(message) { socket.send(JSON.stringify(message)) },
      async next(type, matches = () => true) {
        const deadline = Date.now() + 3200
        while (Date.now() < deadline) {
          const index = messages.findIndex((message) => message.type === type && matches(message))
          if (index >= 0) return messages.splice(index, 1)[0]
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.fail(`等不到 ${type}，收到 ${messages.map((message) => message.type).join(', ')}`)
      },
    }
  }

  const host = await connect()
  const guest = await connect()
  host.send({ type: 'create', visibility: 'private', mode: 'pool', name: '房主' })
  const { code, token } = await host.next('room')
  guest.send({ type: 'join', code, name: '访客' })
  await guest.next('room')
  host.send({ type: 'start' })
  const start = await guest.next('start')
  host.send({ type: 'leave' })
  await guest.next('room', (room) => room.started && !room.players[0].connected)
  assert.ok(token)
  host.send({ type: 'resume', code, token })
  const immediateReturn = await host.next('room', (room) => !!room.state)
  assert.deepEqual(immediateReturn.state, start.state)
  host.socket.close()
  await guest.next('room', (room) => !room.players[0].connected)

  const intruder = await connect()
  intruder.send({ type: 'join', code, name: '房主' })
  await intruder.next('error')
  intruder.send({ type: 'resume', code, token: 'wrong' })
  await intruder.next('resume-denied')

  const shot = await guest.next('shot')
  assert.equal(shot.seat, 0)
  assert.equal(shot.computer, true)
  assert.notDeepEqual(shot.state.balls, start.state.balls)

  const returning = await connect()
  returning.send({ type: 'resume', code, token })
  const resumed = await returning.next('room', (room) => !!room.state)
  assert.equal(resumed.code, code)
  assert.equal(resumed.seat, 0)
  assert.equal(resumed.players[0].connected, true)
  assert.deepEqual(resumed.state, shot.state)
  assert.deepEqual(resumed.match, shot.match)
})

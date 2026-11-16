import assert from 'node:assert/strict'
import test from 'node:test'
import { BilliardsEngine } from '../src/game/engine.js'

function client() {
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state: { mode: 'pool', phase: 'aim', balls: [{ x: 635, y: 635 }] },
    power: 0.45,
    playerPower: null,
    spin: { x: 0, y: 0 },
    playerSpin: { x: 0, y: 0 },
  })
  return engine
}

test('each client restores its own power and spin after displaying the other player’s aim', () => {
  const host = client()
  const guest = client()
  const hostSpin = { x: 0.22, y: -0.15 }
  const guestSpin = { x: -0.4, y: 0.2 }

  host.setInteraction(true)
  host.setPower(0.27)
  host.setSpin(hostSpin)
  guest.setInteraction(true)
  guest.setPower(0.63)
  guest.setSpin(guestSpin)

  for (const [watcher, shooter] of [[host, guest], [guest, host]]) {
    watcher.setInteraction(false)
    const ownPower = watcher.playerPower
    const ownSpin = watcher.playerSpin

    watcher.onPower = (display, saved) => {
      assert.equal(display, watcher.power)
      assert.equal(saved, ownPower)
    }
    watcher.onSpin = (display, saved) => {
      assert.deepEqual(display, watcher.spin)
      assert.deepEqual(saved, ownSpin)
    }
    watcher.applyRemoteAim({ power: shooter.playerPower, spin: shooter.playerSpin })
    assert.equal(watcher.power, shooter.playerPower)
    assert.deepEqual(watcher.spin, shooter.playerSpin)

    watcher.setInteraction(true)
    watcher.shoot()
    assert.equal(watcher.pendingShot.power, ownPower)
    assert.deepEqual(watcher.pendingShot.spin, ownSpin)
  }
})

test('a new online frame keeps the chosen settings and defaults an unplayed break to full power', () => {
  const engine = client()
  engine.renderer = {}
  engine.clearBalls = () => {}
  engine.buildTable = () => {}
  engine.resize = () => {}

  engine.setPower(0.45)
  engine.setSpin({ x: -0.32, y: 0.21 })
  engine.applyRemoteAim({ power: 0.9, spin: { x: 0.1, y: 0.2 } })

  const frame = { mode: 'pool', phase: 'aim', breakShot: true, balls: [] }
  engine.loadMatch(frame, { keepPlayerAim: true })
  engine.setInteraction(true)
  assert.equal(engine.power, 0.45)
  assert.deepEqual(engine.spin, { x: -0.32, y: 0.21 })

  engine.setInteraction(false)
  engine.loadMatch(frame)
  engine.setInteraction(true)
  assert.equal(engine.power, 1)
  assert.deepEqual(engine.spin, { x: 0, y: 0 })
})

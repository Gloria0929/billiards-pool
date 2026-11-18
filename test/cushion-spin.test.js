import assert from 'node:assert/strict'
import test from 'node:test'
import { createMatch, launchShot, mulberry32 } from '../src/game/match.js'
import { bounce, step } from '../src/game/physics.js'
import { DT } from '../src/game/constants.js'

test('满力高杆碰库时，库边摩擦会改变前旋，避免反弹后继续朝库边刹车', () => {
  const state = createMatch('nine', 7)
  state.inHand = state.breakShot = false
  for (const ball of state.balls) ball.on = ball.n === 0
  launchShot(state, { angle: Math.PI / 2, power: 1, spin: { x: 0, y: 0.65 } })
  const cue = state.balls[0]
  for (let i = 0; i < 10000; i++) {
    const spin = cue.wx
    state.events.length = 0
    step(state)
    if (!state.events.some((event) => event.k === 'r')) continue
    assert.ok(cue.vy < 0, '白球应离开底库')
    assert.ok(Math.abs(cue.wx) < Math.abs(spin) * 0.9,
      '碰库时前旋应因库面摩擦减弱，不能完整保留并拖住反弹速度')
    return
  }
  assert.fail('场景未碰到底库')
})

test('正常滚动球碰库后进入滑动再恢复滚动，不能带着原前旋丢掉大半反弹速度', () => {
  const state = createMatch('nine', 7)
  const cue = state.balls[0]
  for (const ball of state.balls) ball.on = ball.n === 0
  Object.assign(cue, { x: 1000, y: 700, vx: 0, vy: 1000, wx: -1000 / state.geo.R, wy: 0 })
  bounce(state, cue, 0, -1)
  for (let i = 0; i < 0.3 / DT; i++) step(state)
  assert.ok(-cue.vy > 450, '碰库后正常滚动球不应在 0.3 秒内从 1000 mm/s 掉到不足 450 mm/s')
})

test('各种方向与旋转碰库后仍向外反弹，且不凭空增加动能', () => {
  const state = createMatch('nine', 7)
  const ball = state.balls[0]
  const random = mulberry32(42)
  const R = state.geo.R
  const energy = () => (ball.vx ** 2 + ball.vy ** 2) / 2 +
    R ** 2 * (ball.wx ** 2 + ball.wy ** 2 + ball.wz ** 2) / 5
  for (let i = 0; i < 256; i++) {
    const angle = random() * Math.PI * 2
    const nx = Math.cos(angle), ny = Math.sin(angle)
    const incoming = 20 + random() * 12000
    const tangent = (random() - 0.5) * 12000
    Object.assign(ball, {
      vx: -nx * incoming - ny * tangent,
      vy: -ny * incoming + nx * tangent,
      wx: (random() - 0.5) * 1000,
      wy: (random() - 0.5) * 1000,
      wz: (random() - 0.5) * 1000,
    })
    const before = energy()
    state.events.length = 0
    bounce(state, ball, nx, ny)
    assert.ok(ball.vx * nx + ball.vy * ny > 0)
    assert.ok(energy() <= before + 1e-6)
  }
})

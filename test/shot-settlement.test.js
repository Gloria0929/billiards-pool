import assert from 'node:assert/strict'
import test from 'node:test'
import { BilliardsEngine } from '../src/game/engine.js'
import { createMatch } from '../src/game/match.js'
import { moving } from '../src/game/physics.js'
import { renderQuality } from '../src/game/render-quality.js'
import { endShot } from '../src/game/rules.js'

function stubAnimationFrame(t) {
  const requestFrame = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => {}
  t.after(() => {
    if (requestFrame) globalThis.requestAnimationFrame = requestFrame
    else delete globalThis.requestAnimationFrame
  })
}

test('桌面 120 Hz 下白球的滚动位移随摩擦平滑减小', (t) => {
  stubAnimationFrame(t)
  const state = createMatch('pool', 7)
  for (const ball of state.balls) ball.on = ball.n === 0
  Object.assign(state.balls[0], { x: 1000, y: 550, vx: 5000 })
  state.phase = 'moving'
  const positions = []
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state, geo: state.geo, quality: renderQuality(false),
    renderer: { shadowMap: {}, render() {} }, aimGroup: {}, cueGroup: {},
    meshes: new Map([[0, {
      mesh: { position: { set(x) { positions.push(x) } } },
      shadow: { position: { set() {} }, scale: { setScalar() {} } },
    }]]),
    last: 0, acc: 0, simTime: 0, animSteps: 0, animating: true,
    spin: { x: 0, y: 0 },
    spinBall() {}, drainEvents() {}, updCam() {},
  })

  for (let frame = 1; frame <= 12; frame++) engine.loop(frame * 1000 / 120)
  assert.equal(positions.length, 12)
  const distances = positions.slice(1).map((x, i) => x - positions[i])
  assert.ok(distances.every((distance, i) => !i || distance < distances[i - 1]),
    `匀速刷新时减速的白球不应前后跳动，实际帧间位移为 ${distances.map((x) => x.toFixed(2))}`)
})

test('白球先入袋，等后续 9 号球的落袋动画结束再判罚和复位', (t) => {
  stubAnimationFrame(t)

  const state = createMatch('nine', 7)
  const cue = state.balls[0]
  const nine = state.balls.find((ball) => ball.n === 9)
  const { W, H, R } = state.geo
  for (const ball of state.balls) ball.on = ball === cue || ball === nine
  // 从首碰 9 号后的球位开始，两球分别滚向两侧中袋。
  Object.assign(cue, { x: W / 2, y: 120, vy: -450, wx: 450 / R })
  Object.assign(nine, { x: W / 2, y: H - 370, vy: 750, wx: -750 / R })
  Object.assign(state, { phase: 'moving', inHand: false, breakShot: false, firstHit: 9 })

  let settled = 0
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state,
    animating: true,
    last: 0,
    acc: 0,
    simTime: 0,
    animSteps: 0,
    spinBall() {},
    drainEvents() {},
    render() {},
    onRest() {
      settled++
      endShot(state)
    },
  })
  let now = 0
  const frame = () => engine.loop(now += 10)
  while (!state.cueIn && now < 2000) frame()
  assert.equal(state.cueIn, true)
  assert.equal(nine.on, true)
  assert.equal(moving(state.balls), true)
  assert.equal(settled, 0)

  while (!state.potted.includes(9) && now < 2000) frame()
  assert.deepEqual(state.potted, [9])
  assert.equal(settled, 0, '9 号球刚入袋，不能立刻判罚')
  assert.equal(state.phase, 'moving')
  for (let i = 0; i < 25; i++) frame()
  assert.equal(settled, 0, '9 号球还在下落')

  while (engine.animating && now < 2500) frame()
  assert.equal(settled, 1)
  assert.match(state.message, /白球落袋/)
  assert.equal(state.turn, 1)
  assert.equal(state.inHand, true)
  assert.equal(nine.on, true)
})

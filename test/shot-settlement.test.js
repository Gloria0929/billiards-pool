import assert from 'node:assert/strict'
import test from 'node:test'
import { BilliardsEngine } from '../src/game/engine.js'
import { createMatch } from '../src/game/match.js'
import { moving } from '../src/game/physics.js'
import { endShot } from '../src/game/rules.js'

test('白球先入袋，等后续 9 号球的落袋动画结束再判罚和复位', (t) => {
  const requestFrame = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => {}
  t.after(() => {
    if (requestFrame) globalThis.requestAnimationFrame = requestFrame
    else delete globalThis.requestAnimationFrame
  })

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

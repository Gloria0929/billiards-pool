import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseAiShot } from '../src/game/ai.js'
import { createMatch, simulateShot } from '../src/game/match.js'
import { canPlaceCue } from '../src/game/physics.js'

function spread(state, before) {
  return state.balls.filter((ball) => ball.n >= 1 && ball.n <= 15 &&
    (!ball.on || Math.hypot(ball.x - before.find((saved) => saved.n === ball.n).x,
      ball.y - before.find((saved) => saved.n === ball.n).y) > 100)).length
}

test('斯诺克电脑三种难度均轻碰侧边开球，合法碰红且不炸散球堆', (t) => {
  t.mock.method(Math, 'random', () => 0.5)
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const seed of [1, 7, 42]) {
      const state = createMatch('snk', seed)
      state.turn = state.opener = 1
      const before = structuredClone(state)
      const shot = chooseAiShot(state, 1, difficulty)
      assert.deepEqual(state, before, '选杆不能修改实际球局')
      assert.ok(canPlaceCue(state, shot.cue.x, shot.cue.y))
      assert.ok(shot.power <= 0.38, `${difficulty} 开球不应大力冲散红球`)
      simulateShot(state, shot)
      assert.ok(state.firstHit >= 1 && state.firstHit <= 15)
      assert.equal(state.cueIn, false)
      assert.equal(state.phase, 'aim')
      assert.deepEqual(state.sn.score, [0, 0])
      assert.ok(spread(state, before.balls) <= 2, `种子 ${seed} 的红球堆被炸散`)
    }
  }
})

test('轻碰开局后，电脑正常接打也不无故大力炸堆', (t) => {
  let noise = 0.5
  t.mock.method(Math, 'random', () => noise)
  const opening = createMatch('snk', 7)
  const target = opening.balls.find((ball) => ball.n === 15)
  const cue = { x: 591, y: 1078.8 }
  const distance = Math.hypot(target.x - cue.x, target.y - cue.y)
  simulateShot(opening, {
    cue,
    angle: Math.atan2(target.y - cue.y, target.x - cue.x) + Math.asin(2 * opening.geo.R * 0.85 / distance),
    power: 0.35,
  })
  assert.equal(opening.turn, 1)
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const value of [0.01, 0.5, 0.99]) {
      noise = value
      const state = structuredClone(opening)
      const shot = chooseAiShot(state, 1, difficulty)
      simulateShot(state, shot)
      assert.ok(state.firstHit >= 1 && state.firstHit <= 15)
      assert.equal(state.phase, 'aim')
      // 允许少量红球散开，绝大多数红球仍留在原来的球堆。
      assert.ok(spread(state, opening.balls) <= 3, `${difficulty} 防守开局后接打不能马上把红球堆炸开`)
    }
  }
})

test('中八和九球电脑仍然满力开球', () => {
  for (const mode of ['pool', 'nine']) {
    const state = createMatch(mode, 7)
    const shot = chooseAiShot(state, 1, 'normal')
    assert.equal(shot.power, 1)
  }
})

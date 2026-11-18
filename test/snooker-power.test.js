import assert from 'node:assert/strict'
import test from 'node:test'
import { MODES, DT } from '../src/game/constants.js'
import { buildAimGuide } from '../src/game/guide.js'
import { createMatch, launchShot } from '../src/game/match.js'
import { moving, step } from '../src/game/physics.js'

function emptyTable(mode = 'snk') {
  const state = createMatch(mode, 7)
  state.inHand = state.breakShot = false
  for (const ball of state.balls) ball.on = ball.n === 0
  Object.assign(state.balls[0], { x: 600, y: 600, mu: 1 })
  return state
}

function roll(state) {
  let distance = 0
  let rails = 0
  let steps = 0
  while (moving(state.balls) && steps++ < 20 / DT) {
    const { x, y } = state.balls[0]
    step(state)
    distance += Math.hypot(state.balls[0].x - x, state.balls[0].y - y)
    rails += state.events.filter((event) => event.k === 'r').length
    state.events.length = 0
  }
  assert.ok(!moving(state.balls), '白球须在模拟上限内停稳')
  return { distance, rails }
}

test('斯诺克低力度能轻推：10% 不超过 10 厘米，30% 不跑满台碰库', () => {
  for (const [power, maxTravel] of [[0.1, 100], [0.3, 2000]]) {
    const state = emptyTable()
    launchShot(state, { angle: 0, power })
    const result = roll(state)
    assert.ok(result.distance < maxTravel,
      `${power * 100}% 力度滚动了 ${Math.round(result.distance)} mm，应小于 ${maxTravel} mm`)
    assert.equal(result.rails, 0)
  }
})

test('斯诺克默认 35% 可温和开球，满力仍保留长台出球能力', () => {
  for (const seed of [1, 7, 42]) {
    const state = createMatch('snk', seed)
    const cue = state.balls[0]
    const target = state.balls.find((ball) => ball.n === 15)
    const position = { x: 591, y: 1093 }
    launchShot(state, {
      cue: position,
      angle: Math.atan2(target.y - position.y, target.x - position.x),
      power: MODES.snk.breakPower,
    })
    assert.ok(Math.hypot(cue.vx, cue.vy) < 1500, '斯诺克开球不应叠加中八式爆冲加速')
    for (let i = 0; moving(state.balls) && state.firstHit === null && i < 20 / DT; i++) step(state)
    assert.ok(state.firstHit >= 1 && state.firstHit <= 15, `种子 ${seed} 的默认开球应到达红球`)
  }
  const state = emptyTable()
  launchShot(state, { angle: 0, power: 1 })
  assert.ok(state.balls[0].vx >= 8000)
})

test('斯诺克轻推的辅助线终点与实际停止位置一致', () => {
  const state = emptyTable()
  const shot = { power: 0.2, spin: { x: 0, y: 0 }, breakShot: false }
  const guide = buildAimGuide(state.geo, state.balls, 0, true, shot)
  launchShot(state, { ...shot, angle: 0 })
  roll(state)
  assert.equal(guide.hitBall, null)
  assert.equal(guide.cueBank, null)
  assert.ok(Math.hypot(guide.ghost.x - state.balls[0].x, guide.ghost.y - state.balls[0].y) < 2)
})

test('中八与九球的 30% 出球和开球速度保持原手感', () => {
  for (const mode of ['pool', 'nine']) {
    for (const breaking of [false, true]) {
      const state = emptyTable(mode)
      state.breakShot = breaking
      launchShot(state, { angle: 0, power: 0.3 })
      assert.ok(Math.abs(state.balls[0].vx - (breaking ? 6187 : 2690)) < 0.001)
    }
  }
})

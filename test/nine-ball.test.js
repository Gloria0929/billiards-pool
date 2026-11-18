import assert from 'node:assert/strict'
import test from 'node:test'
import { createMatch, launchShot } from '../src/game/match.js'
import { moving, step } from '../src/game/physics.js'
import { endShot, nineTargetNumber } from '../src/game/rules.js'

function layout(locations) {
  const state = createMatch('nine', 7)
  state.breakShot = state.inHand = false
  for (const ball of state.balls) {
    ball.on = Object.hasOwn(locations, ball.n)
    if (ball.on) [ball.x, ball.y] = locations[ball.n]
  }
  return state
}

function settle(state, {
  first = null,
  pots = [],
  scratch = false,
  rail = true,
} = {}) {
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = first
  state.potted = pots
  state.cueIn = scratch
  state.railAfterContact = rail
  for (const ball of state.balls)
    if (pots.includes(ball.n) || (scratch && ball.n === 0)) ball.on = false
  state.phase = 'aim'
  endShot(state)
}

test('九球摆成菱形：1 号在顶点，9 号在中心', () => {
  const state = createMatch('nine', 42)
  assert.equal(state.balls.length, 10)
  assert.deepEqual(
    state.balls.filter((ball) => ball.n > 0).map((ball) => ball.n).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
  const one = state.balls.find((ball) => ball.n === 1)
  const nine = state.balls.find((ball) => ball.n === 9)
  assert.ok(one.x < nine.x, '1 号应在 9 号靠开球端一侧')
  assert.ok(Math.abs(nine.y - state.geo.H / 2) < 2 * state.geo.R)
  const dx = state.geo.R * Math.sqrt(3)
  assert.ok(nine.x - one.x > dx * 1.4 && nine.x - one.x < dx * 2.6)
})

test('九球先碰错球判犯规并交自由球', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 2: [1000, 600] })
  settle(state, { first: 2 })
  assert.equal(state.turn, 1)
  assert.equal(state.inHand, true)
  assert.match(state.message, /首先碰到的不是1号球/)
})

test('九球合法打进 9 号球本局结束', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 9: [1100, 600] })
  settle(state, { first: 1, pots: [9] })
  assert.equal(state.phase, 'over')
  assert.equal(state.winner, 0)
  assert.match(state.message, /合法打进9号球/)
})

test('九球开球合法进 9 号直接获胜，不复位也不要求额外碰库', () => {
  for (const turn of [0, 1]) {
    const state = createMatch('nine', 7)
    state.turn = turn
    settle(state, { first: 1, pots: [9], rail: false })
    assert.equal(state.phase, 'over')
    assert.equal(state.winner, turn)
    assert.equal(state.balls.find((ball) => ball.n === 9).on, false)
    assert.equal(state.breakChoice, null)
    assert.match(state.message, /开球合法打进9号球/)
  }
})

test('九球开球进 9 号同时犯规，不获胜并复位 9 号', () => {
  for (const shot of [{ first: 1, scratch: true }, { first: 2 }, {}]) {
    const state = createMatch('nine', 7)
    settle(state, { ...shot, pots: [9] })
    assert.equal(state.phase, 'aim')
    assert.equal(state.winner, null)
    assert.equal(state.balls.find((ball) => ball.n === 9).on, true)
    assert.equal(state.turn, 1)
    assert.equal(state.inHand, true)
    assert.deepEqual(state.nineFouls, [1, 0])
  }
})

test('九球白球落袋同时进 9：9 号复位，对手自由球', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 9: [1100, 600] })
  settle(state, { first: 1, pots: [9], scratch: true })
  const nine = state.balls.find((ball) => ball.n === 9)
  assert.notEqual(state.phase, 'over')
  assert.equal(nine.on, true)
  assert.equal(state.turn, 1)
  assert.equal(state.inHand, true)
})

test('九球打进最小号球后继续，目标顺延', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 2: [1000, 600] })
  settle(state, { first: 1, pots: [1] })
  assert.equal(state.turn, 0)
  assert.equal(nineTargetNumber(state), 2)
})

test('九球击球后无球碰库判犯规', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600] })
  settle(state, { first: 1, rail: false })
  assert.equal(state.turn, 1)
  assert.equal(state.inHand, true)
  assert.match(state.message, /无球碰库/)
})

test('九球开球未达标时对手可选择接受或重开', () => {
  const state = createMatch('nine', 3)
  state.inHand = false
  launchShot(state, { angle: 0, power: 0.2 })
  state.firstHit = 1
  state.firstHits = [1]
  state.potted = []
  state.railBalls = [2, 3]
  state.railAfterContact = false
  endShot(state)
  assert.equal(state.phase, 'choice')
  assert.equal(state.breakChoice.kind, 'miss')
  assert.equal(state.turn, 1)
})

test('九球 9 号被击出球台：复位并判犯规', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 9: [1100, 600] })
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = 1
  state.firstHits = [1]
  state.potted = []
  state.offTable = [9]
  state.railAfterContact = true
  state.balls.find((ball) => ball.n === 9).on = false
  endShot(state)
  const nine = state.balls.find((ball) => ball.n === 9)
  assert.notEqual(state.phase, 'over')
  assert.equal(nine.on, true)
  assert.equal(state.turn, 1)
  assert.equal(state.inHand, true)
  assert.match(state.message, /有球离开台面/)
})

test('九球连续三次犯规判负', () => {
  const state = layout({ 0: [500, 600], 1: [800, 600], 2: [1000, 600] })
  state.nineFouls = [2, 0]
  settle(state, { first: 2 })
  assert.equal(state.phase, 'over')
  assert.equal(state.winner, 1)
  assert.match(state.message, /连续3次犯规/)
})

function rollToRest(state) {
  let guard = 0
  while (moving(state.balls) && guard++ < 400000) step(state)
}

test('贴库球沿库边滚过中袋不落袋，到底袋才进', () => {
  const state = createMatch('nine', 9)
  state.breakShot = state.inHand = false
  for (const ball of state.balls) ball.on = ball.n === 0
  const cue = state.balls[0]
  cue.x = state.geo.W / 2 - 500
  cue.y = state.geo.R + 0.05
  launchShot(state, { angle: 0, power: 0.55 })
  rollToRest(state)
  assert.equal(state.cueIn, true)
  assert.ok(cue.q, '应落进角袋')
  assert.equal(cue.q[0], state.geo.W)
  assert.equal(cue.q[1], 0)
})

test('正常打进中袋仍然有效', () => {
  const state = createMatch('nine', 9)
  state.breakShot = state.inHand = false
  for (const ball of state.balls) ball.on = ball.n === 0
  const cue = state.balls[0]
  cue.x = state.geo.W / 2
  cue.y = state.geo.R + 300
  launchShot(state, { angle: -Math.PI / 2, power: 0.35 })
  rollToRest(state)
  assert.equal(state.cueIn, true)
  assert.ok(cue.q)
  assert.equal(cue.q[0], state.geo.W / 2)
})

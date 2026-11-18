import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAimGuide } from '../src/game/guide.js'
import { createMatch, launchShot } from '../src/game/match.js'
import { moving, step } from '../src/game/physics.js'
import { BilliardsEngine } from '../src/game/engine.js'

function layout(locations, mode = 'nine') {
  const state = createMatch(mode, 7)
  state.inHand = state.breakShot = false
  for (const ball of state.balls) {
    ball.on = Object.hasOwn(locations, ball.n)
    if (ball.on) [ball.x, ball.y] = locations[ball.n]
  }
  return state
}

function trace(state, shot, until) {
  const trial = structuredClone(state)
  launchShot(trial, shot)
  for (let i = 0; i < 40000 && moving(trial.balls); i++) {
    step(trial)
    if (until(trial)) return trial
    trial.events.length = 0
  }
  return trial
}

test('加左右塞时，目标球辅助线与实际碰撞后的出球方向一致', () => {
  const state = layout({ 0: [500, 635], 1: [950, 635] })
  const directions = []
  for (const x of [-0.6, 0, 0.6]) {
    const shot = { angle: 0, power: 0.4, spin: { x, y: 0 } }
    const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
    const actual = trace(state, shot, (trial) => trial.firstHit !== null)
    const ball = actual.balls.find((ball) => ball.n === 1)
    const predicted = Math.atan2(guide.object.to.y - guide.object.from.y,
      guide.object.to.x - guide.object.from.x)
    const observed = Math.atan2(ball.vy, ball.vx)
    assert.ok(Math.abs(predicted - observed) < 0.005,
      `侧旋 ${x} 的辅助线角度 ${predicted} 与实际 ${observed} 不符`)
    directions.push(predicted)
  }
  assert.ok(directions[0] < directions[1] && directions[1] < directions[2])
})

test('打向中袋的白球辅助线应直达袋口，不能预测从袋口反弹', () => {
  const state = layout({ 0: [1270, 600] })
  const shot = { angle: -Math.PI / 2, power: 0.3 }
  const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
  const actual = trace(state, shot, (trial) => trial.cueIn)
  assert.equal(actual.cueIn, true)
  assert.equal(guide.cueBank, null, '袋口开口不能作为直线库边')
})

test('力度不足时辅助线在白球停球处结束，不显示碰到目标球', () => {
  const state = layout({ 0: [500, 635], 1: [1800, 635] })
  const shot = { angle: 0, power: 0.01 }
  const actual = trace(state, shot, () => false)
  const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
  assert.equal(actual.firstHit, null)
  assert.equal(guide.hitBall, null)
  assert.ok(Math.abs(guide.ghost.x - actual.balls[0].x) < 2)
})

test('加塞的碰库反弹路线与实际出球和停球位置一致', () => {
  for (const x of [-0.6, 0, 0.6]) {
    const state = layout({ 0: [850, 480] })
    const shot = { angle: -0.7, power: 0.25, spin: { x, y: -0.2 } }
    const actual = trace(state, shot, (trial) =>
      trial.events.filter((event) => event.k === 'r').length > 0)
    const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
    assert.ok(guide.cueBank)
    assert.ok(Math.hypot(guide.cueBank.from.x - actual.balls[0].x,
      guide.cueBank.from.y - actual.balls[0].y) < 0.01)
    let rails = 0
    const end = trace(state, shot, (trial) => {
      rails += trial.events.filter((event) => event.k === 'r').length
      return rails >= 2
    })
    assert.ok(Math.hypot(guide.cueBank.to.x - end.balls[0].x,
      guide.cueBank.to.y - end.balls[0].y) < 0.01)
  }
})

test('高低杆改变碰球后的白球路线，预览不改动球位或击球状态', () => {
  const directions = []
  for (const y of [-0.6, 0.6]) {
    const state = layout({ 0: [650, 635], 1: [850, 635] })
    const saved = structuredClone(state)
    const shot = { angle: 0, power: 0.3, spin: { x: 0, y } }
    const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
    directions.push(guide.deflect.to.x - guide.deflect.from.x)
    assert.deepEqual(state, saved)
  }
  assert.ok(directions[0] < 0, '低杆回拉')
  assert.ok(directions[1] > 0, '高杆跟进')
})

test('贴库球穿过中袋继续沿库滚动，辅助线只在真正落袋处显示提示', () => {
  const state = layout({ 0: [770, 28.65] })
  const shot = { angle: 0, power: 0.55 }
  const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
  assert.equal(guide.cueBank, null)
  assert.equal(guide.cuePocket.x, state.geo.W)
  assert.equal(guide.cuePocket.y, 0)
})

test('辅助线缓存随力度、加塞和摆球刷新，静止瞄准复用预测', () => {
  const state = layout({ 0: [500, 635], 1: [950, 635] })
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state, geo: state.geo, angle: 0, power: 0.3,
    spin: { x: 0, y: 0 }, guideMode: 'full',
  })
  let guide = engine.getAimGuide()
  assert.equal(engine.getAimGuide(), guide)
  engine.spin.x = 0.5
  assert.notEqual(engine.getAimGuide(), guide)
  guide = engine.getAimGuide()
  engine.power = 0.01
  assert.notEqual(engine.getAimGuide(), guide)
  guide = engine.getAimGuide()
  state.balls[0].x = 720
  assert.notEqual(engine.getAimGuide(), guide)
})

test('三种球台的薄球接触点与实际击球一致', () => {
  for (const mode of ['pool', 'nine', 'snk']) {
    const state = layout({ 0: [500, 635], 1: [950, 660] }, mode)
    const shot = { angle: 0, power: 0.5, spin: { x: 0.4, y: -0.3 } }
    const actual = trace(state, shot, (trial) => trial.firstHit !== null)
    const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
    assert.equal(guide.hitBall.n, actual.firstHit)
    assert.ok(Math.hypot(guide.ghost.x - actual.balls[0].x,
      guide.ghost.y - actual.balls[0].y) < 0.01)
  }
})

test('目标球入袋提示与实际袋口一致，被其他球挡住时不穿透预测', () => {
  const state = layout({ 0: [1270, 700], 1: [1270, 500] })
  const shot = { angle: -Math.PI / 2, power: 0.3 }
  const guide = buildAimGuide(state.geo, state.balls, shot.angle, true, shot)
  const actual = trace(state, shot, (trial) => trial.potted.includes(1))
  assert.ok(actual.potted.includes(1))
  assert.equal(guide.objectBank, null)
  assert.equal(guide.objectPocket.x, 1270)
  assert.equal(guide.objectPocket.y, -state.geo.py)

  const blocked = layout({ 0: [500, 635], 1: [950, 635], 2: [1150, 635] })
  const straight = { angle: 0, power: 0.4 }
  const blockGuide = buildAimGuide(blocked.geo, blocked.balls, straight.angle, true, straight)
  const contact = trace(blocked, straight, (trial) =>
    trial.events.some((event) => event.k === 'b' && event.id === '1-2'))
  assert.equal(blockGuide.objectPocket, null)
  assert.ok(Math.abs(blockGuide.object.to.x - contact.balls[1].x) < 0.01)
})

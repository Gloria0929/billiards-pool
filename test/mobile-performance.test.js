import assert from 'node:assert/strict'
import test from 'node:test'
import { BilliardsEngine } from '../src/game/engine.js'
import { createMatch } from '../src/game/match.js'
import { AiPlanner } from '../src/game/ai-planner.js'
import { renderQuality } from '../src/game/render-quality.js'

test('移动端拖动瞄准时复用辅助线，松手立即重算准确落点', () => {
  const state = createMatch('snk', 7)
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state, geo: state.geo, angle: 0, power: 0.35, spin: { x: 0, y: 0 },
    guideMode: 'simple', quality: renderQuality(true, 3), aiming: true,
  })
  const initial = engine.getAimGuide()
  engine.aimGuideAt = performance.now()
  engine.angle += 0.01
  assert.equal(engine.getAimGuide(), initial, '连续拖动不应逐帧执行完整物理预测')
  engine.aiming = false
  assert.notEqual(engine.getAimGuide(), initial, '松手后不能沿用过期的瞄准线')
})

test('打开菜单时不继续渲染和推进球局', (t) => {
  const previous = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => {}
  t.after(() => {
    if (previous) globalThis.requestAnimationFrame = previous
    else delete globalThis.requestAnimationFrame
  })
  let rendered = 0
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    overlayOpen: true, last: 0, render() { rendered++ },
  })
  engine.loop(16)
  assert.equal(rendered, 0)
})

test('取消电脑思考后结束后台线程，旧结果不能触发出杆', async () => {
  const workers = []
  const planner = new AiPlanner(() => {
    const worker = { postMessage() {}, terminate() { this.terminated = true } }
    workers.push(worker)
    return worker
  })
  const state = createMatch('snk', 7)
  const first = planner.plan(state, 1, 'hard')
  const second = planner.plan(state, 1, 'normal')
  assert.equal(await first, null)
  assert.equal(workers[0].terminated, true)
  workers[0].onmessage({ data: { shot: { power: 1 } } })
  const shot = { angle: 0.2, power: 0.35 }
  workers[1].onmessage({ data: { shot } })
  assert.deepEqual(await second, shot)
  assert.equal(workers[1].terminated, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { BilliardsEngine } from '../src/game/engine.js'
import { createMatch } from '../src/game/match.js'
import { AiPlanner } from '../src/game/ai-planner.js'
import { renderQuality } from '../src/game/render-quality.js'
import { GuidePlanner } from '../src/game/guide-planner.js'
import { batchStaticMeshes } from '../src/game/static-meshes.js'
import { BoxGeometry, Box3, Group, Mesh, MeshStandardMaterial } from 'three'

test('手机端首次瞄准、拖动和松手都把球路预测交给后台', () => {
  const state = createMatch('snk', 7)
  const requests = []
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    state, geo: state.geo, angle: 0, power: 0.35, spin: { x: 0, y: 0 },
    guideMode: 'simple', quality: renderQuality(true, 3),
    guidePlanner: { request(key, data, done) { requests.push({ key, data, done }) } },
  })
  assert.equal(engine.getAimGuide(), undefined)
  const initial = { cuePath: {} }
  requests[0].done(initial, requests[0].key)
  engine.aiming = true
  engine.angle += 0.01
  assert.equal(engine.getAimGuide(), initial, '连续拖动不应逐帧执行完整物理预测')
  engine.aiming = false
  engine.angle += 0.01
  assert.equal(engine.getAimGuide(), initial)
  assert.equal(requests[2].data.angle, engine.angle)
  const latest = { cuePath: { points: [] } }
  requests[2].done(latest, requests[2].key)
  assert.equal(engine.getAimGuide(), latest)
  engine.invalidateAimGuide()
  requests[2].done(latest, requests[2].key)
  assert.equal(engine.getAimGuide(), null, '换球位后应忽略上一球位的预测结果')
})

test('移动端限制高分屏绘制像素，同时保留抗锯齿与球体细节', () => {
  const quality = renderQuality(true, 3)
  assert.equal(quality.pixelRatio, 1.5)
  assert.equal(renderQuality(true, 1).pixelRatio, 1)
  assert.equal(renderQuality(false, 3).pixelRatio, 2)
  assert.equal(quality.antialias, true)
  assert.deepEqual(quality.ballSegments, renderQuality(false, 3).ballSegments)
  assert.equal(quality.backgroundGuide, true)
  assert.equal(quality.dynamicShadows, false)
})

test('重复的手机尺寸通知只分配一次 WebGL 画布', () => {
  let sizes = 0
  const line = { material: { resolution: { set() {} } } }
  const engine = Object.assign(Object.create(BilliardsEngine.prototype), {
    renderer: { setPixelRatio() {}, setSize() { sizes++ } },
    container: { clientWidth: 390, clientHeight: 650 },
    quality: renderQuality(true, 3),
    cam: { updateProjectionMatrix() {} },
    lineA: line, lineB: line, lineC: line, bankCueLine: line, bankObjectLine: line,
  })
  engine.resize()
  engine.resize()
  assert.equal(sizes, 1)
  engine.container.clientHeight = 620
  engine.resize()
  assert.equal(sizes, 2)
})

test('后台辅助线只保留最新等待输入，防止连续拖动积压旧任务', () => {
  const sent = []
  const worker = { postMessage(data) { sent.push(data) }, terminate() {} }
  const planner = new GuidePlanner(() => worker)
  const results = []
  const done = (guide, key) => results.push(key)
  planner.request('first', { angle: 0 }, done)
  planner.request('middle', { angle: 1 }, done)
  planner.request('latest', { angle: 2 }, done)
  assert.equal(sent.length, 1)
  worker.onmessage({ data: {} })
  assert.deepEqual(sent, [{ angle: 0 }, { angle: 2 }])
  worker.onmessage({ data: {} })
  assert.deepEqual(results, ['first', 'latest'])
  planner.dispose()
})

test('静态合批减少绘制部件，同时保留形状、材质和阴影属性', () => {
  const root = new Group()
  const material = new MeshStandardMaterial()
  for (let i = 0; i < 12; i++) {
    const mesh = new Mesh(new BoxGeometry(2, 3, 4), material)
    mesh.position.set(i * 5, i, -i)
    mesh.rotation.y = i * 0.1
    mesh.castShadow = true
    root.add(mesh)
  }
  const before = new Box3().setFromObject(root)
  batchStaticMeshes(root)
  assert.equal(root.children.length, 1)
  assert.equal(root.children[0].material, material)
  assert.equal(root.children[0].castShadow, true)
  const after = new Box3().setFromObject(root)
  assert.ok(before.min.distanceTo(after.min) < 0.0001)
  assert.ok(before.max.distanceTo(after.max) < 0.0001)
  assert.equal(root.children[0].geometry.attributes.position.count, 12 * 36)
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

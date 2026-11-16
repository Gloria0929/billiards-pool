// 开球回归基准：用固定随机种子批量模拟「满力、正对球堆」的中八开球，
// 统计乔氏四球次过线的合法率与「死开」（≤2 球次）比例。
// 手感调参后跑一遍，避免把开球调回"满力也开不散"。
//
// 用法: node scripts/break-bench.mjs [--seeds=120]
import { createMatch, launchShot } from '../src/game/match.js'
import { moving, step } from '../src/game/physics.js'
import { poolBreakCount } from '../src/game/rules.js'
import { MAX_SIM_STEPS, MODES } from '../src/game/constants.js'

const args = process.argv.slice(2)
const seedsArg = args.find((a) => a.startsWith('--seeds='))
const N = Math.max(1, Number(seedsArg?.split('=')[1]) || 120)

const W = MODES.pool.W
const H = MODES.pool.H

let legal = 0
let dead = 0
let pottedSum = 0
let spreadSum = 0
const crossings = []

for (let seed = 1; seed <= N; seed++) {
  const state = createMatch('pool', seed, ['A', 'B'])
  const cue = state.balls[0]
  const apex = state.balls[1]
  const angle = Math.atan2(apex.y - cue.y, apex.x - cue.x)
  launchShot(state, {
    angle,
    power: 1,
    spin: { x: 0, y: 0 },
    cue: { x: cue.x, y: cue.y },
  })
  let steps = 0
  while (moving(state.balls) && steps < MAX_SIM_STEPS) {
    step(state)
    steps++
  }
  const potted = state.potted.length
  const count = poolBreakCount(state)
  crossings.push(count)
  pottedSum += potted
  if (count >= 4) legal++
  if (count <= 2) dead++
  const onTable = state.balls.filter((b) => b.on && b.n !== 0)
  const cx = W * 0.77
  const cy = H / 2
  spreadSum +=
    onTable.reduce((s, b) => s + Math.hypot(b.x - cx, b.y - cy), 0) / onTable.length
}

crossings.sort((a, b) => a - b)
const pct = (n) => `${((n / N) * 100).toFixed(1)}%`
const legalPct = (legal / N) * 100
const deadPct = (dead / N) * 100
const median = crossings[Math.floor(crossings.length / 2)]

console.log(`样本 ${N} 局（固定种子 1..${N}，满力、正对球堆、无加塞）`)
console.log(`  合法开球（≥4 球次）: ${legal}/${N}  ${pct(legal)}`)
console.log(`  死开（≤2 球次）    : ${dead}/${N}  ${pct(dead)}`)
console.log(`  球次中位数          : ${median}`)
console.log(`  平均进球            : ${(pottedSum / N).toFixed(2)}`)
console.log(`  平均散开半径        : ${(spreadSum / N).toFixed(0)} mm`)

const ok = legalPct >= 80 && deadPct <= 10
console.log(ok ? '通过：开球手感达标。' : '未通过：合法率应 ≥80%，死开应 ≤10%。')
process.exit(ok ? 0 : 1)

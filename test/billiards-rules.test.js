import assert from 'node:assert/strict'
import test from 'node:test'
import { colorSpot } from '../src/game/geometry.js'
import {
  createMatch,
  launchShot,
  offerStalemate,
  resolveBreakChoice,
  resolveFrameChoice,
  simulateShot,
} from '../src/game/match.js'
import { canPlaceCue } from '../src/game/physics.js'
import {
  endShot,
  canConcedeFrame,
  isSnookered,
  offerConcession,
  poolBreakCount,
  resolveSnookerChoice,
  snookerPointsRemaining,
} from '../src/game/rules.js'

function layout(mode, locations) {
  const state = createMatch(mode, 7)
  state.breakShot = state.inHand = false
  for (const ball of state.balls) {
    ball.on = Object.hasOwn(locations, ball.n)
    if (ball.on) [ball.x, ball.y] = locations[ball.n]
  }
  return state
}

function settle(state, { first = null, pots = [], scratch = false } = {}) {
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = first
  state.potted = pots
  state.cueIn = scratch
  for (const ball of state.balls)
    if (pots.includes(ball.n) || (scratch && ball.n === 0)) ball.on = false
  endShot(state)
}

const colors = {
  16: [737, 1181],
  17: [737, 597],
  18: [737, 889],
  19: [1784.5, 889],
  20: [2676.75, 889],
  21: [3245, 889],
}

test('开球计入过程中越线的球，即使球又滚回线前', () => {
  const state = createMatch('pool', 7)
  simulateShot(state, { angle: 0, power: 1 })
  assert.ok(poolBreakCount(state) >= 4)
  assert.ok(state.balls.filter((b) => b.on && b.n && b.x <= state.geo.W / 4).length < 4)
  assert.deepEqual(state.breakMisses, [0, 0])
})

test('开放台只按首碰组中的入袋球定组', () => {
  const state = layout('pool', { 0: [500, 500], 1: [800, 500], 9: [1000, 500], 8: [1300, 500] })
  settle(state, { first: 1, pots: [9] })
  assert.deepEqual(state.grp, [null, null])
  assert.equal(state.turn, 1)

  settle(state, { first: 1, pots: [1] })
  assert.deepEqual(state.grp, ['stripe', 'solid'])
  assert.equal(state.turn, 1)
})

test('开球白球落袋后可取线后自由球或重新开球', () => {
  const state = createMatch('pool', 7)
  settle(state, { first: 1, scratch: true })
  assert.equal(state.breakChoice.kind, 'foul')
  assert.equal(state.breakChoice.seat, 1)
  const rerack = structuredClone(state)
  resolveBreakChoice(rerack, 'rerack', 0)
  assert.equal(rerack.turn, 0)
  assert.ok(rerack.breakShot)
  resolveBreakChoice(state, 'accept')
  assert.ok(state.inHandLine)
  assert.ok(canPlaceCue(state, state.balls[0].x, state.balls[0].y))
})

test('出杆入口拒绝中八开球线外与斯诺克 D 区外的白球坐标', () => {
  for (const mode of ['pool', 'snk']) {
    const state = createMatch(mode, 7)
    const invalid = { x: state.geo.W / 2, y: state.geo.H * 0.7 }
    assert.equal(canPlaceCue(state, invalid.x, invalid.y), false)
    launchShot(state, { cue: invalid })
    assert.notDeepEqual(state.shotAnchor, invalid)
    assert.ok(state.shotAnchor.x <= (mode === 'pool' ? state.geo.W / 4 : 737))
  }
})

test('线后手中球不得直接打线后目标球', () => {
  const state = layout('pool', { 0: [500, 500], 1: [300, 500], 9: [1500, 400], 8: [1700, 500] })
  state.inHand = state.inHandLine = true
  simulateShot(state, { angle: Math.PI, power: 0.5 })
  assert.equal(state.firstHit, 1)
  assert.match(state.message, /直接击中了线后的球/)
  assert.ok(state.inHand)
  assert.equal(state.inHandLine, false)
})

test('最后一红随白球入袋，下一杆是黄球', () => {
  const state = layout('snk', { 0: [500, 500], 1: [900, 500], ...colors })
  settle(state, { first: 1, pots: [1], scratch: true })
  assert.deepEqual(state.sn.score, [0, 4])
  assert.equal(state.sn.finalColor, false)
  assert.equal(state.sn.idx, 0)
  assert.match(state.message, /目标:黄球/)
})

test('以黑代粉，仅进自由球时仍然打粉球', () => {
  const state = layout('snk', { 0: [1500, 500], 20: colors[20], 21: colors[21] })
  Object.assign(state.sn, { onRed: false, idx: 4, freeBall: 21 })
  settle(state, { first: 21, pots: [21] })
  assert.deepEqual(state.sn.score, [6, 0])
  assert.equal(state.sn.idx, 4)
  assert.equal(state.phase, 'aim')
  assert.equal(state.balls.find((ball) => ball.n === 21).on, true)
})

test('进红后首碰蓝球再白球落袋，按蓝球价值罚 5 分', () => {
  const state = layout('snk', { 0: [600, 550], 1: [1400, 500], ...colors })
  state.sn.onRed = false
  settle(state, { first: 19, scratch: true })
  assert.equal(state.sn.score[1], 5)
})

test('最后一红后的彩球按首碰计分，下一杆开始按顺序清彩', () => {
  const state = layout('snk', { 0: [600, 550], 1: [1400, 500], ...colors })
  settle(state, { first: 1, pots: [1] })
  settle(state, { first: 19, pots: [19] })
  assert.deepEqual(state.sn.score, [6, 0])
  assert.equal(state.turn, 0)
  assert.match(state.message, /目标:黄球/)
  settle(state, { first: 17 })
  assert.equal(state.sn.score[1], 4)
})

test('进红后打离贴着的彩球，无需提名也算合法击球', () => {
  const state = layout('snk', { 0: [600, 550], 1: [1400, 500], ...colors })
  state.sn.onRed = false
  const blue = state.balls.find((ball) => ball.n === 19)
  blue.x = 600 - 2 * state.geo.R
  blue.y = 550
  settle(state)
  assert.equal(state.turn, 1)
  assert.equal(state.sn.choice, null)
  assert.deepEqual(state.sn.score, [0, 0])
})

test('蓝球点被占用时，蓝球回到最高分的空彩球点', () => {
  const state = layout('snk', { 0: [600, 550], 1: colors[19], ...colors, 21: [2900, 550] })
  state.sn.onRed = false
  settle(state, { first: 19, pots: [19] })
  const blue = state.balls.find((ball) => ball.n === 19)
  assert.deepEqual([blue.x, blue.y], colorSpot(state.geo, 21))
})

test('红球互相遮边不构成斯诺克', () => {
  const state = layout('snk', { 0: [100, 500], 1: [300, 540], 2: [300, 480] })
  assert.equal(isSnookered(state, state.balls.filter((b) => b.on && b.n)), false)
})

test('已需罚分时，普通空杆不触发 Miss', () => {
  const state = layout('snk', { 0: [500, 400], 1: [1000, 400], ...colors })
  state.sn.score = [0, 100]
  settle(state)
  assert.equal(state.sn.choice.miss, false)
  assert.equal(state.phase, 'choice')
})

test('被遮挡的原位无法触发连续三次判负，满球原位重打则可以', () => {
  for (const obstructed of [true, false]) {
    const state = layout('snk', {
      0: [400, 400], 1: [1100, 400], ...colors,
      21: obstructed ? [750, 400] : colors[21],
    })
    for (let i = 0; i < 3; i++) {
      settle(state)
      if (i === 1) assert.equal(state.sn.choice.warn, !obstructed)
      if (i < 2) resolveSnookerChoice(state, 'replay')
    }
    assert.equal(state.phase, obstructed ? 'choice' : 'over')
  }
})

test('下一杆先打彩时，剩分计入这颗彩球', () => {
  const state = layout('snk', { 0: [500, 400], 1: [1000, 400], ...colors })
  assert.equal(snookerPointsRemaining(state), 35)
  state.sn.freeBall = 21
  assert.equal(snookerPointsRemaining(state), 43)
  state.sn.freeBall = null
  state.sn.onRed = false
  assert.equal(snookerPointsRemaining(state), 42)
})

test('开球进黑八后由开球方决定续打或重开', () => {
  const state = createMatch('pool', 7)
  launchShot(state, { angle: 0, power: 1 })
  state.firstHit = 1
  state.breakCrossed = [8, 2, 3]
  state.potted = [8]
  state.balls.find((b) => b.n === 8).on = false
  endShot(state)
  assert.deepEqual(state.breakChoice, { kind: 'eight', seat: 0, offender: 0 })
  assert.equal(state.balls.find((b) => b.n === 8).on, true)
  const restarted = resolveBreakChoice(structuredClone(state), 'rerack', 1)
  assert.equal(restarted.turn, 0)
  assert.equal(restarted.breakShot, true)
  resolveBreakChoice(state, 'accept')
  assert.equal(state.turn, 0)
  assert.equal(state.phase, 'aim')
})

test('手中球可换到 D 区其他位置解球时，不给自由球', () => {
  const state = layout('snk', { 0: [530, 889], 1: [1800, 889], 21: [900, 889] })
  const reds = state.balls.filter((b) => b.on && b.n === 1)
  assert.equal(isSnookered(state, reds), true)
  state.inHand = true
  assert.equal(isSnookered(state, reds), false)
})

test('清掉粉球后即使分差超过 7 分，也保留黑球继续打', () => {
  for (const score of [[40, 60], [60, 40]]) {
    const state = layout('snk', { 0: [500, 400], 20: colors[20], 21: colors[21] })
    Object.assign(state.sn, { onRed: false, idx: 4, score: [...score] })
    settle(state, { first: 20, pots: [20] })
    assert.equal(state.phase, 'aim')
    assert.equal(state.winner, null)
    assert.equal(state.turn, 0)
    assert.equal(state.sn.idx, 5)
    assert.equal(snookerPointsRemaining(state), 7)
    assert.match(state.message, /目标:黑球/)

    const trailing = state.sn.score[0] < state.sn.score[1] ? 0 : 1
    assert.ok(state.sn.score[trailing] + snookerPointsRemaining(state) < state.sn.score[1 - trailing])
  }
})

test('分差超过 7 分时，最后黑球无论进袋、未进或犯规都判领先方胜', () => {
  for (const score of [[60, 40], [40, 60]]) {
    for (const turn of [0, 1]) {
      for (const shot of [{ first: 21 }, { first: 21, pots: [21] }, { scratch: true }]) {
        const state = layout('snk', { 0: [500, 400], 21: colors[21] })
        Object.assign(state.sn, { onRed: false, idx: 5, score: [...score] })
        state.turn = turn
        settle(state, shot)
        assert.equal(state.phase, 'over')
        assert.equal(state.winner, score[0] > score[1] ? 0 : 1)
        const expected = [...score]
        expected[shot.scratch ? 1 - turn : turn] += shot.scratch || shot.pots ? 7 : 0
        assert.deepEqual(state.sn.score, expected)
      }
    }
  }
})

test('最后黑球分差不超过 7 分时，合法未进球仍继续', () => {
  for (const difference of [0, 6, 7]) {
    const state = layout('snk', { 0: [500, 400], 21: colors[21] })
    Object.assign(state.sn, { onRed: false, idx: 5, score: [40 + difference, 40] })
    settle(state, { first: 21 })
    assert.equal(state.phase, 'aim')
    assert.equal(state.winner, null)
    assert.equal(state.turn, 1)
  }
})

test('黑球复位抽签获胜者可选择让对方先打', () => {
  const state = layout('snk', { 0: [500, 400], 21: colors[21] })
  Object.assign(state.sn, { onRed: false, idx: 5, score: [40, 47] })
  settle(state, { first: 21, pots: [21] })
  assert.equal(state.sn.choice.kind, 'black')
  const other = 1 - state.sn.choice.seat
  resolveFrameChoice(state, 'again')
  assert.equal(state.turn, other)
  assert.ok(state.inHand)
  assert.ok(state.sn.decider)
})

test('对手可拒绝认输，接受才结算', () => {
  const state = createMatch('snk', 7)
  state.sn.score = [0, 200]
  offerConcession(state, 0)
  assert.equal(state.phase, 'choice')
  resolveFrameChoice(state, 'again')
  assert.equal(state.phase, 'aim')
  assert.equal(state.turn, 0)
  offerConcession(state, 0)
  resolveFrameChoice(state, 'play')
  assert.equal(state.phase, 'over')
  assert.equal(state.winner, 1)
})

test('只要有一方需要罚分，当前击球者就可提出认输', () => {
  const state = layout('snk', { 0: [500, 400], 1: [1000, 400], ...colors })
  for (const score of [[0, 35], [35, 0], [0, 0]]) {
    state.sn.score = score
    assert.equal(canConcedeFrame(state, 0), false)
    offerConcession(state, 0)
    assert.equal(state.phase, 'aim')
    assert.equal(state.sn.choice, null)
  }
  for (const score of [[0, 36], [36, 0]]) {
    state.sn.score = score
    assert.equal(canConcedeFrame(state, 0), true)
    assert.equal(canConcedeFrame(state, 1), false)
  }
  state.sn.freeBall = 21
  assert.equal(canConcedeFrame(state, 0), false)
  state.sn.freeBall = null
  state.phase = 'moving'
  assert.equal(canConcedeFrame(state, 0), false)
  state.phase = 'aim'
  state.mode = 'pool'
  assert.equal(canConcedeFrame(state, 0), false)
})

test('红球后未指定彩球即空杆或误碰红球，罚 7 分', () => {
  for (const finalColor of [false, true]) {
    for (const first of finalColor ? [null] : [null, 1]) {
      const state = layout('snk', { 0: [500, 400], ...(finalColor ? {} : { 1: [1000, 400] }), ...colors })
      Object.assign(state.sn, { onRed: false, finalColor })
      settle(state, { first, scratch: first === 1 })
      assert.deepEqual(state.sn.score, [0, 7])
      assert.equal(state.phase, 'choice')
    }
  }
})

test('击动贴着的指定黑球仍犯规，但代红时只罚 4 分', () => {
  const state = layout('snk', { 0: [600, 550], 1: [1400, 500], ...colors })
  state.sn.freeBall = 21
  const black = state.balls.find((ball) => ball.n === 21)
  black.x = 600 + 2 * state.geo.R
  black.y = 550
  settle(state, { first: 21 })
  assert.deepEqual(state.sn.score, [0, 4])
  assert.match(state.message, /击动了贴球/)
})

test('拒绝认输保留当前球位、手中球和已指定自由球', () => {
  const state = layout('snk', { 0: [500, 400], 1: [1000, 400], ...colors })
  Object.assign(state.sn, { score: [200, 0], freeBall: 21 })
  state.inHand = true
  const balls = structuredClone(state.balls)
  offerConcession(state, 0)
  assert.equal(state.sn.choice.kind, 'concede')
  assert.equal(state.sn.choice.seat, 1)
  resolveFrameChoice(state, 'again')
  assert.equal(state.phase, 'aim')
  assert.equal(state.turn, 0)
  assert.equal(state.inHand, true)
  assert.equal(state.sn.freeBall, 21)
  assert.deepEqual(state.balls, balls)
  offerConcession(state, 0)
  resolveFrameChoice(state, 'play')
  assert.equal(state.winner, 1)
  assert.equal(state.sn.choice, null)
  assert.equal(state.sn.freeBall, null)
})

test('Miss 原位重打恢复红后打彩状态，留位重打结束连续判负序列', () => {
  const state = layout('snk', { 0: [500, 400], 1: [1000, 400], ...colors })
  state.sn.onRed = false
  const balls = state.balls.map(({ n, x, y, on }) => ({ n, x, y, on }))
  settle(state)
  assert.equal(state.sn.choice.miss, true)
  state.balls[0].x = 650
  resolveFrameChoice(state, 'replay')
  assert.equal(state.sn.onRed, false)
  assert.deepEqual(state.balls.map(({ n, x, y, on }) => ({ n, x, y, on })), balls)
  settle(state)
  assert.equal(state.sn.choice.warn, true)
  resolveFrameChoice(state, 'again')
  assert.deepEqual(state.sn.missStreak, { seat: null, count: 0 })
  assert.equal(state.turn, 0)
  assert.equal(state.sn.onRed, true)
})

test('抢黑犯规立即结束，不遗留犯规选择', () => {
  const state = layout('snk', { 0: [500, 400], 21: colors[21] })
  Object.assign(state.sn, { onRed: false, idx: 5, decider: true, score: [47, 47] })
  settle(state, { scratch: true })
  assert.equal(state.phase, 'over')
  assert.equal(state.winner, 1)
  assert.deepEqual(state.sn.score, [47, 54])
  assert.equal(state.sn.choice, null)
})

test('贴着指定自由球时可合法打离，不能仅凭贴着真目标球满足首碰', () => {
  for (const touchingFree of [true, false]) {
    const state = layout('snk', {
      0: [600, 550], 1: [1400, 500], ...colors,
    })
    state.sn.freeBall = 21
    const touching = state.balls.find((ball) => ball.n === (touchingFree ? 21 : 1))
    touching.x = 600 - 2 * state.geo.R
    touching.y = 550
    settle(state)
    assert.deepEqual(state.sn.score, touchingFree ? [0, 0] : [0, 4])
    assert.equal(state.phase, touchingFree ? 'aim' : 'choice')
    if (touchingFree) assert.equal(state.turn, 1)
  }
})

test('指定自由球与球在同时首碰合法，其他同时首碰按最高价值罚分', () => {
  for (const hits of [[1, 2], [21, 1], [16, 21], [1, 21]]) {
    const state = layout('snk', { 0: [600, 550], 1: [1400, 500], 2: [1600, 500], ...colors })
    const free = hits[0] === 21
    state.sn.freeBall = free ? 21 : null
    launchShot(state, { angle: 0, power: 0.3 })
    state.firstHit = hits[0]
    state.firstHits = hits
    endShot(state)
    const legal = free || hits.every((n) => n <= 15)
    assert.deepEqual(state.sn.score, legal ? [0, 0] : [0, 7])
  }
})

test('自由球和真目标同进：红球分别计分，彩球只计一次并复位自由球', () => {
  for (const redOn of [true, false]) {
    const state = layout('snk', { 0: [600, 550], ...(redOn ? { 1: [1400, 500] } : {}), ...colors })
    Object.assign(state.sn, { onRed: redOn, freeBall: 21 })
    const target = redOn ? 1 : 16
    settle(state, { first: 21, pots: [21, target] })
    assert.deepEqual(state.sn.score, [2, 0])
    assert.equal(state.turn, 0)
    assert.equal(state.phase, 'aim')
    assert.equal(state.balls.find((ball) => ball.n === 21).on, true)
    assert.equal(state.balls.find((ball) => ball.n === target).on, false)
    if (redOn) assert.equal(state.sn.finalColor, true)
    else assert.equal(state.sn.idx, 1)
  }
})

test('同意重摆后由原开球者重开，保留中八累计失机', () => {
  for (const mode of ['pool', 'snk']) {
    const state = createMatch(mode, 7)
    state.turn = 0
    state.opener = 1
    state.breakShot = false
    state.breakMisses = [1, 2]
    if (mode === 'snk') state.sn.score = [23, 12]
    offerStalemate(state)
    const restarted = resolveFrameChoice(state, 'play')
    assert.equal(restarted.breakShot, true)
    assert.equal(restarted.turn, 1)
    assert.equal(restarted.phase, 'aim')
    assert.deepEqual(restarted.sn.score, [0, 0])
    if (mode === 'pool') assert.deepEqual(restarted.breakMisses, [1, 2])
  }
})

import { cueSpot, colorSpot } from './geometry.js'
import { castRay, free, place } from './physics.js'

const STRIPE_THRESHOLD = 8
const SNK_NAMES = ['黄', '绿', '棕', '蓝', '粉', '黑']
const colorName = (n) => SNK_NAMES[n - 16] || '彩'

export const isStripe = (n) => (n < STRIPE_THRESHOLD ? 'solid' : 'stripe')
export const playerLabel = (state, seat) =>
  (state.names && state.names[seat]) || `玩家${seat + 1}`

const COLOR_VALUES = [2, 3, 4, 5, 6, 7]
const colorValue = (n) => (n <= 15 ? 1 : COLOR_VALUES[n - 16])
const redsOnTable = (state) =>
  state.balls.filter((b) => b.on && b.n >= 1 && b.n <= 15).length

// 开球犯规后，白球只能放在开球线后；从开球点向左侧找空位。
function placeCueInLine(geo, balls) {
  const cue = balls[0]
  const y = geo.H / 2
  for (let d = 0; d < 30; d++) {
    const x = geo.W / 4 - d * 2 * geo.R
    if (x < geo.R) break
    if (!free(geo, balls, x, y, cue)) continue
    cue.x = x
    cue.y = y
    cue.on = true
    cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0
    cue.st = 0
    cue.q = null
    cue.fallSpin = null
    return
  }
  place(geo, balls, cue, ...cueSpot(geo))
}

function finish(state, winner, why) {
  state.phase = 'over'
  state.winner = winner
  state.message =
    winner < 0
      ? `平局(${why})`
      : `${playerLabel(state, winner)}获胜!(${why})`
}

function endPool(state) {
  const { geo } = state
  const me = state.turn
  const op = 1 - me
  const group = state.grp[me]
  const wasBreak = state.breakShot
  const railBalls = state.railBalls || []
  let foul = ''
  let txt = ''

  if (state.cueIn) foul = '白球落袋'
  else if (state.firstHit === null) foul = '未碰到任何球'
  else if (group) {
    if (
      state.canEight
        ? state.firstHit !== 8
        : state.firstHit === 8 || isStripe(state.firstHit) !== group
    )
      foul = '首先碰到了错误的球'
  } else if (state.firstHit === 8) foul = '首先碰到了8号球'

  // 合法开球：有目标球入袋，或至少 4 颗目标球碰库。
  if (wasBreak && !foul) {
    if (!state.potted.some((n) => n >= 1) && railBalls.length < 4)
      foul = '开球未进球且目标球碰库不足4颗'
  }

  // 合法击球：主球碰目标球后，若没有目标球入袋，必须有球碰库。
  if (!foul && !wasBreak && state.potted.length === 0 && !state.railAfterContact)
    foul = '击球后无球碰库'

  if (state.potted.includes(8)) {
    if (wasBreak) {
      place(
        geo,
        state.balls,
        state.balls.find((b) => b.n === 8),
        geo.W * 0.72,
        geo.H / 2,
      )
      txt = '开球时8号球落袋,已摆回。'
    } else {
      finish(
        state,
        state.canEight && !foul ? me : op,
        state.canEight && !foul ? '合法打进8号球' : '8号球违规落袋',
      )
      return
    }
  }

  if (!group && !foul && !wasBreak) {
    const first = state.potted.find((n) => n !== 8)
    if (first) {
      state.grp[me] = isStripe(first)
      state.grp[op] = state.grp[me] === 'solid' ? 'stripe' : 'solid'
      txt += `${playerLabel(state, me)}打${
        state.grp[me] === 'solid' ? '全色' : '花色'
      }。`
    }
  }

  const own = state.grp[me]
  const pottedEight = state.potted.includes(8)
  const continues =
    !foul &&
    (wasBreak
      ? pottedEight || state.potted.some((n) => n !== 8)
      : own && state.potted.some((n) => n !== 8 && isStripe(n) === own))

  // 开球犯规后白球只能放在开球线后，先摆回开球区。
  if (state.cueIn || (foul && wasBreak)) {
    if (foul && wasBreak) placeCueInLine(geo, state.balls)
    else place(geo, state.balls, state.balls[0], ...cueSpot(geo))
  }
  state.breakShot = false

  if (foul) {
    state.turn = op
    state.inHand = true
    state.inHandLine = wasBreak
    txt += `犯规:${foul}。${playerLabel(state, op)}${
      wasBreak
        ? '线后自由球(只能放在开球线后)'
        : '自由球(俯视下可拖动白球)'
    }`
  } else if (continues) {
    txt += wasBreak
      ? '开球进球,继续击球(此时不定花色,之后进球才定)'
      : `进球!${playerLabel(state, me)}继续击球`
  } else {
    state.turn = op
    txt += `轮到${playerLabel(state, op)}击球`
  }
  state.message = txt
}

// 平分决胜：黑球复位到黑球点，白球放回 D 区，随机一方先手。
function startBlackOff(state) {
  const { geo } = state
  const black = state.balls.find((b) => b.n === 21)
  black.on = true
  place(geo, state.balls, black, ...colorSpot(geo, 21))
  const cue = state.balls[0]
  cue.on = true
  place(geo, state.balls, cue, ...cueSpot(geo))
  state.turn = Math.random() < 0.5 ? 0 : 1
  state.inHand = true
  state.breakShot = false
  state.sn.decider = true
  state.sn.finalColor = false
  state.sn.freeBall = null
  state.sn.choice = null
  state.sn.missStreak = { seat: null, count: 0 }
  state.phase = 'aim'
  state.message = `平分,黑球复位,${playerLabel(
    state,
    state.turn,
  )}先打黑球决胜`
}

function endBlackOff(state) {
  const me = state.turn
  const op = 1 - me
  const first = state.firstHit
  const pottedBlack = state.potted.includes(21)
  const foul = state.cueIn || first === null || first !== 21
  const why = state.cueIn
    ? '白球落袋'
    : first === null
      ? '未击中黑球'
      : '先碰了错误的球'

  if (!foul && pottedBlack) {
    state.sn.score[me] += 7
    finish(state, me, '黑球决胜')
    return
  }
  if (foul) {
    state.sn.score[op] += 7
    finish(state, op, `黑球决胜犯规:${why}`)
    return
  }

  // 合法但没进：交换击球权，黑球留在台面。
  state.turn = op
  state.sn.freeBall = null
  state.sn.choice = null
  state.phase = 'aim'
  state.message = `未进黑球,轮到${playerLabel(state, op)} · 黑球决胜`
}

function snookerTarget(state) {
  if (state.sn.decider) return '黑球'
  if (state.sn.freeBall) {
    const on = state.sn.onRed
      ? '红球'
      : state.sn.finalColor
        ? '任意彩球'
        : `${colorName(16 + state.sn.idx)}球`
    return `${on}或${colorName(state.sn.freeBall)}球(自由球)`
  }
  if (redsOnTable(state) > 0)
    return state.sn.onRed ? '红球' : '任意彩球'
  if (state.sn.finalColor) return '任意彩球'
  return ('黄绿棕蓝粉黑'[state.sn.idx] || '黑') + '球'
}

// 目标球的两侧边缘是否都能被白球直线打到。
function edgesClear(geo, balls, cue, target) {
  const dx = target.x - cue.x
  const dy = target.y - cue.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 2 * geo.R) return true
  const px = -dy / distance
  const py = dx / distance
  for (const sign of [1, -1]) {
    const ex = target.x + sign * px * geo.R
    const ey = target.y + sign * py * geo.R
    const vx = ex - cue.x
    const vy = ey - cue.y
    const length = Math.hypot(vx, vy)
    if (length < 1e-6) continue
    const hit = castRay(
      geo,
      balls,
      cue.x,
      cue.y,
      vx / length,
      vy / length,
      target.n,
    )
    if (hit.ball && hit.t < length - 0.5) return false
  }
  return true
}

// 白球被完全阻挡：没有任何一颗目标球的两侧边缘都能被直线击中。
export function isSnookered(state, targets) {
  const cue = state.balls[0]
  return !targets.some((target) =>
    edgesClear(state.geo, state.balls, cue, target),
  )
}

// 台面剩余最多能拿到的分数：每颗红球按“红+黑”8 分算，彩球满分 27；
// 红球清完后按台面剩余彩球计分；最后一颗红球后的彩球可再拿一次最高 7 分。
export function snookerPointsRemaining(state) {
  const reds = redsOnTable(state)
  if (reds > 0) return reds * 8 + 27
  let sum = 0
  for (const ball of state.balls)
    if (ball.on && ball.n >= 16) sum += colorValue(ball.n)
  if (state.sn.finalColor) sum += 7
  return sum
}

export function concedeFrame(state, seat) {
  if (!state || state.phase === 'over') return state
  finish(state, 1 - seat, `${playerLabel(state, seat)}认输`)
  state.sn.choice = null
  return state
}

export function resolveSnookerChoice(state, decision, freeBall = null) {
  const choice = state.sn && state.sn.choice
  if (!choice) return state
  const snapshot = choice.snapshot
  state.sn.freeBall = null
  if (decision === 'replay' && snapshot) {
    for (const saved of snapshot.balls) {
      const ball = state.balls.find((b) => b.n === saved.n)
      if (!ball) continue
      ball.x = saved.x
      ball.y = saved.y
      ball.on = saved.on
      ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0
      ball.st = 0
      ball.q = null
      ball.fallSpin = null
    }
    state.turn = snapshot.turn
    state.grp = [...snapshot.grp]
    state.inHand = snapshot.inHand
    state.inHandLine = snapshot.inHandLine
    state.breakShot = snapshot.breakShot
    state.canEight = snapshot.canEight
    // 重打必须连同“目标球”一起恢复：原本在打彩球，重打也应打彩球。
    if (snapshot.sn) {
      state.sn.onRed = !!snapshot.sn.onRed
      state.sn.idx = snapshot.sn.idx
      state.sn.finalColor = !!snapshot.sn.finalColor
    }
    state.message = `${playerLabel(
      state,
      state.turn,
    )}重打 · 球位已恢复 · 目标:${snookerTarget(state)}`
  } else if (decision === 'again') {
    // 让犯规方从球停下的位置重打；foul and a miss 的重打序列随之结束。
    state.turn = choice.offender
    state.sn.missStreak = { seat: null, count: 0 }
    state.message = `${playerLabel(
      state,
      choice.offender,
    )}重打 · 目标:${snookerTarget(state)}`
  } else {
    state.turn = choice.seat
    state.sn.missStreak = { seat: null, count: 0 }
    // 自由球可以是除“目标球”以外的任何彩球；按顺序打彩球时排除当前那颗。
    const seqColor =
      state.sn.onRed || state.sn.finalColor ? null : 16 + state.sn.idx
    const freeOk =
      choice.freeBall &&
      Number.isInteger(freeBall) &&
      freeBall >= 16 &&
      freeBall <= 21 &&
      freeBall !== seqColor &&
      state.balls.some((ball) => ball.on && ball.n === freeBall)
    state.sn.freeBall = freeOk ? freeBall : null
    state.message = `${playerLabel(state, choice.seat)}击球 · 目标:${snookerTarget(state)}`
  }
  state.sn.choice = null
  state.phase = 'aim'
  state.firstHit = null
  state.potted = []
  state.cueIn = false
  return state
}

function endSnooker(state) {
  if (state.sn.decider) {
    endBlackOff(state)
    return
  }
  const { geo } = state
  const me = state.turn
  const op = 1 - me
  state.breakShot = false
  const freeBall = state.sn.freeBall
  state.sn.freeBall = null
  const pottedReds = state.potted.filter((n) => n <= 15).length
  const redsAtStart = redsOnTable(state) + pottedReds > 0
  const finalColor = !!state.sn.finalColor
  const nextColor = 16 + state.sn.idx
  const first = state.firstHit
  const freeActive = freeBall !== null

  let foul = state.cueIn || first === null
  let why = state.cueIn
    ? '白球落袋'
    : first === null
      ? '未击中任何球'
      : ''
  let points = 0
  let txt = ''
  let legalFirst = true

  // 犯规罚分：球在值、先碰球、落袋球三者取最大，最低 4 分。
  const ballOnValue = redsAtStart
    ? state.sn.onRed
      ? 1
      : 4
    : finalColor
      ? 4
      : colorValue(nextColor)
  let foulValue = Math.max(4, ballOnValue)

  if (first !== null) {
    legalFirst = freeActive
      ? first === freeBall
      : redsAtStart
        ? state.sn.onRed
          ? first <= 15
          : first >= 16
        : finalColor
          ? first >= 16
          : first === nextColor
    if (!legalFirst) {
      foul = true
      foulValue = Math.max(foulValue, colorValue(first))
      why = '先碰了错误的球'
    }
  }
  const isMiss = first === null || !legalFirst

  // 自由球按“目标球”计值：红球 1 分；按顺序打彩球时按当前彩球分值。
  const freeValue = (n) =>
    state.sn.onRed
      ? 1
      : state.sn.finalColor
        ? colorValue(n)
        : colorValue(nextColor)
  // 彩球阶段若同时打进自由球和真正的目标球，只有目标球计分。
  const freeBallAlsoBallOn =
    freeActive &&
    !state.sn.onRed &&
    state.potted.some(
      (n) =>
        n !== freeBall && (state.sn.finalColor || n === nextColor),
    )

  for (const n of state.potted) {
    const isFree = freeActive && n === freeBall
    const legal = redsAtStart
      ? state.sn.onRed
        ? n <= 15 || isFree
        : n >= 16 && (freeActive || n === first)
      : finalColor
        ? n >= 16 && (freeActive || n === first)
        : n === nextColor || isFree
    if (legal) {
      if (!isFree) points += colorValue(n)
      else if (!freeBallAlsoBallOn) points += freeValue(n)
    } else {
      foul = true
      foulValue = Math.max(foulValue, isFree ? freeValue(n) : colorValue(n))
      why = why || '打进了错误的球'
    }
  }

  // 彩球复位：红球阶段、最后一颗红球后的那颗彩球、犯规打进的彩球，
  // 以及被指定为自由球的彩球（自由球永远复位）。
  for (const n of state.potted)
    if (
      n >= 16 &&
      (redsAtStart || finalColor || foul || (freeActive && n === freeBall))
    )
      place(geo, state.balls, state.balls.find((b) => b.n === n), ...colorSpot(geo, n))
  if (state.cueIn) place(geo, state.balls, state.balls[0], ...cueSpot(geo))

  if (foul) {
    state.sn.score[op] += foulValue
    state.turn = op
    state.inHand = state.cueIn
    if (redsOnTable(state) > 0) {
      state.sn.onRed = true
      state.sn.finalColor = false
    } else {
      state.sn.onRed = false
      if (redsAtStart) {
        // 最后一颗红球本杆离台：下一位任选一颗彩球。
        state.sn.idx = 0
        state.sn.finalColor = true
      } else if (finalColor) {
        // 最后一颗红球后的彩球阶段犯规：从黄球重新开始。
        state.sn.idx = 0
        state.sn.finalColor = false
      }
    }
    // 只有在“未击中目标球”的重打序列里才判负：连续第三次未击中目标球。
    let warn = false
    if (isMiss) {
      const streak = state.sn.missStreak || { seat: null, count: 0 }
      const count = streak.seat === me ? streak.count + 1 : 1
      state.sn.missStreak = { seat: me, count }
      if (count >= 3) {
        state.sn.choice = null
        finish(state, op, '三次未击中目标球判负')
        return
      }
      warn = count === 2
    } else {
      state.sn.missStreak = { seat: null, count: 0 }
    }
    // 犯规后白球被斯诺克即可申请自由球，打红球或彩球阶段都适用；
    // 白球落袋属于手中球，不存在“被斯诺克”。
    const colors = state.balls.filter((b) => b.on && b.n >= 16)
    const targets = state.sn.onRed
      ? state.balls.filter((b) => b.on && b.n >= 1 && b.n <= 15)
      : state.sn.finalColor
        ? colors
        : state.balls.filter((b) => b.on && b.n === nextColor)
    const freeAward =
      !state.cueIn && targets.length > 0 && isSnookered(state, targets)
    txt = `犯规:${why},${playerLabel(state, op)}得${foulValue}分`
    state.sn.choice = state.shotStart
      ? {
          seat: op,
          offender: me,
          snapshot: state.shotStart,
          freeBall: freeAward,
          miss: isMiss,
          warn,
        }
      : null
    if (freeAward) txt += ' · 白球被完全阻挡,可选择自由球'
    if (state.sn.choice)
      txt += isMiss
        ? ' · 可选择自己击球、让对手重打或回原位重打'
        : ' · 可选择自己击球或让对手重打'
    if (warn) txt += ' · 警告:再次未击中目标球将判负'
    state.phase = state.sn.choice ? 'choice' : 'aim'
  } else {
    state.sn.missStreak = { seat: null, count: 0 }
    state.sn.score[me] += points
    const pottedFree = freeActive && state.potted.includes(freeBall)
    if (redsAtStart) {
      if (state.sn.onRed) {
        if (state.potted.some((n) => n <= 15) || pottedFree) {
          state.sn.finalColor = redsOnTable(state) === 0
          state.sn.onRed = false
          txt = `进球+${points}分,继续击球`
        } else {
          state.turn = op
          state.sn.onRed = true
          txt = `未进球,轮到${playerLabel(state, op)}`
        }
      } else if (state.potted.length) {
        state.sn.onRed = true
        state.sn.finalColor = false
        txt = `进球+${points}分,继续击球`
      } else {
        state.turn = op
        state.sn.onRed = true
        txt = `未进球,轮到${playerLabel(state, op)}`
      }
    } else if (finalColor) {
      state.sn.finalColor = false
      state.sn.idx = 0
      state.sn.onRed = false
      if (state.potted.length) txt = `进球+${points}分,继续击球`
      else {
        state.turn = op
        txt = `未进球,轮到${playerLabel(state, op)}`
      }
    } else if (state.potted.includes(nextColor) || pottedFree) {
      state.sn.idx++
      if (state.sn.idx <= 5) txt = `进球+${points}分,继续击球`
    } else {
      state.turn = op
      txt = `未进球,轮到${playerLabel(state, op)}`
    }
    state.sn.choice = null
    state.phase = 'aim'
  }

  // 只剩黑球时，第一次进球或犯规即结束本局；同分则黑球复位决胜。
  if (foul && state.sn.idx >= 5) {
    const a = state.sn.score[0]
    const b = state.sn.score[1]
    if (a === b) {
      startBlackOff(state)
      return
    }
    finish(state, a > b ? 0 : 1, `黑球阶段犯规 ${a} : ${b}`)
    return
  }

  if (state.sn.idx > 5) {
    const a = state.sn.score[0]
    const b = state.sn.score[1]
    if (a === b) {
      startBlackOff(state)
      return
    }
    finish(state, a > b ? 0 : 1, `${a} : ${b}`)
    return
  }

  state.message = txt + ' · 目标:' + snookerTarget(state)
}

export function endShot(state) {
  if (state.mode === 'pool') endPool(state)
  else endSnooker(state)
}

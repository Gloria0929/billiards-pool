import { BX, DR } from './constants.js'
import { colorSpot } from './geometry.js'
import { free, place, placeCue } from './physics.js'

const STRIPE_THRESHOLD = 8
const SNK_NAMES = ['黄', '绿', '棕', '蓝', '粉', '黑']
const colorName = (n) => SNK_NAMES[n - 16] || '彩'

export const isStripe = (n) => (n < STRIPE_THRESHOLD ? 'solid' : 'stripe')
export const playerLabel = (state, seat) =>
  (state.names && state.names[seat]) || `玩家${seat + 1}`

const COLOR_VALUES = [2, 3, 4, 5, 6, 7]
const colorValue = (n) => n >= 1 && n <= 15 ? 1 : COLOR_VALUES[n - 16]
const redsOnTable = (state) =>
  state.balls.filter((b) => b.on && b.n >= 1 && b.n <= 15).length

function spotPoolBall(state, number) {
  const { geo, balls } = state
  const ball = balls.find((b) => b.n === number)
  const x0 = geo.W * 0.75
  const y = geo.H / 2
  for (const direction of [1, -1]) {
    for (let x = x0; x >= geo.R && x <= geo.W - geo.R; x += direction) {
      if (free(geo, balls, x, y, ball)) {
        place(geo, balls, ball, x, y)
        return
      }
    }
  }
  place(geo, balls, ball, x0, y)
}

export const poolBreakCount = (state) => (state.breakCrossed?.length || 0) + state.potted.length

export function acceptLineBallInHand(state) {
  state.inHand = true
  state.inHandLine = true
  const line = state.geo.W / 4
  const targets = state.balls.filter((b) => b.on && b.n !== 0 && b.n !== 8)
  if (targets.length && targets.every((b) => b.x < line)) {
    const nearest = targets.reduce((best, b) => b.x > best.x ? b : best)
    spotPoolBall(state, nearest.n)
  }
  placeCue(state)
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
  let foul = ''
  let txt = ''

  const firstHits = state.firstHits?.length ? state.firstHits
    : state.firstHit === null ? [] : [state.firstHit]
  const legalHits = firstHits.filter((n) => {
    if (wasBreak) return true
    if (state.canEight) return n === 8
    return n !== 8 && (!group || isStripe(n) === group)
  })
  const pottedEight = state.potted.includes(8)

  if (state.cueIn) foul = '白球落袋'
  else if (state.offTable?.length) foul = '有球离开台面'
  else if (!firstHits.length) foul = '未碰到任何球'
  else if (!legalHits.length) foul = '首先碰到了错误的球'
  else if (
    state.shotStart?.inHandLine && !wasBreak && !state.cueCrossedLine &&
    legalHits.every((n) => state.shotStart.balls.find((b) => b.n === n).x < geo.W / 4)
  ) foul = '从开球线后直接击中了线后的球'
  else if (!wasBreak && !state.potted.length && !state.railAfterContact)
    foul = '击球后无球碰库'

  if (!wasBreak && state.offTable?.includes(8)) {
    finish(state, op, '8号球离开台面')
    return
  }
  if (!wasBreak && pottedEight) {
    const won = state.canEight && !foul
    finish(state, won ? me : op, won ? '合法打进8号球' : '8号球违规落袋')
    return
  }

  const breakMiss = wasBreak && !foul && poolBreakCount(state) < 4
  if (wasBreak && (pottedEight || state.offTable?.includes(8))) spotPoolBall(state, 8)
  if (wasBreak && (foul || (pottedEight && !breakMiss))) {
    const kind = foul ? (firstHits.length || state.cueIn || state.offTable?.length ? 'foul' : 'no-contact') : 'eight'
    state.breakShot = false
    state.turn = foul ? op : me
    state.breakChoice = { seat: state.turn, offender: me, kind }
    state.phase = 'choice'
    state.message = foul ? `开球犯规:${foul}` : '开球打进8号球 · 选择复位续打或重开'
    return
  }

  if (breakMiss) {
    const misses = state.breakMisses || [0, 0]
    misses[me] += 1
    state.breakMisses = misses
    if (misses[me] % 3 === 0) {
      finish(state, op, `累计${misses[me]}次开球失机判负`)
      return
    }
    state.breakShot = false
    state.turn = op
    state.breakChoice = { seat: op, offender: me, kind: 'miss' }
    state.phase = 'choice'
    state.message = `开球失机(累计${misses[me]}次) · ${playerLabel(
      state,
      op,
    )}选择接受台面或重新开球`
    return
  }

  if (!group && !foul && !wasBreak) {
    const first = legalHits.find((n) => state.potted.some((p) => isStripe(p) === isStripe(n)))
    if (first) {
      state.grp[me] = isStripe(first)
      state.grp[op] = state.grp[me] === 'solid' ? 'stripe' : 'solid'
      txt += `${playerLabel(state, me)}打${
        state.grp[me] === 'solid' ? '全色' : '花色'
      }。`
    }
  }

  const own = state.grp[me]
  const continues = !foul && (wasBreak ? state.potted.length > 0
    : own && state.potted.some((n) => n !== 8 && isStripe(n) === own))

  state.breakShot = false
  if (foul) {
    state.turn = op
    state.inHand = true
    if (state.cueIn || state.offTable?.includes(0)) placeCue(state)
    txt += `犯规:${foul}。${playerLabel(state, op)}自由球(俯视下可拖动白球)`
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

/* ---------- 九球 ---------- */

export function lowestBall(balls) {
  let best = null
  for (const ball of balls) {
    if (!ball.on || ball.n <= 0) continue
    if (!best || ball.n < best.n) best = ball
  }
  return best
}

export function nineTargetNumber(state) {
  const ball = lowestBall(state.balls)
  return ball ? ball.n : null
}

// 9 号球复位：脚点及其两侧最近的空位。
function spotNine(state) {
  const nine = state.balls.find((ball) => ball.n === 9)
  if (!nine) return
  nine.on = true
  nine.vx = nine.vy = nine.wx = nine.wy = nine.wz = 0
  nine.st = 0
  nine.q = null
  nine.fallSpin = null
  spotPoolBall(state, 9)
}

function endNine(state) {
  const me = state.turn
  const op = 1 - me
  const wasBreak = state.breakShot
  const potted = state.potted || []
  const offTable = state.offTable || []
  // 合法目标取击球前台面最小号球：进袋后目标会立刻变化。
  const startBalls = state.shotStart?.balls || state.balls
  const target = lowestBall(startBalls)
  const targetN = target ? target.n : null
  const firstHits = state.firstHits?.length
    ? state.firstHits
    : state.firstHit === null ? [] : [state.firstHit]

  let foul = ''
  if (state.cueIn) foul = '白球落袋'
  else if (offTable.length) foul = '有球离开台面'
  else if (!firstHits.length) foul = '未碰到任何球'
  else if (targetN !== null && !firstHits.includes(targetN))
    foul = `首先碰到的不是${targetN}号球`
  else if (!potted.length && !state.railAfterContact && !wasBreak)
    foul = '击球后无球碰库'

  const pottedNine = potted.includes(9)
  const nineOffTable = offTable.includes(9)

  // 开球未达标：对手可选择接受台面或重新开球。
  const breakLegal = potted.length > 0 || (state.railBalls?.length || 0) >= 4
  if (wasBreak && !breakLegal && !foul) {
    state.breakShot = false
    state.turn = op
    state.breakChoice = { seat: op, offender: me, kind: 'miss' }
    state.phase = 'choice'
    state.message = '开球未达标(无球入袋且不足四球碰库) · 对手可选择接受台面或重新开球'
    return
  }

  const fouls = state.nineFouls || [0, 0]
  state.breakShot = false

  if (pottedNine && !foul && !wasBreak) {
    finish(state, me, '合法打进9号球')
    return
  }
  if (pottedNine && wasBreak && !foul) {
    spotNine(state)
    state.turn = me
    state.message = '开球打进9号球 · 9号复位，继续击球'
    return
  }
  // 9 号球违规落袋或被击出球台：复位，不能借此结束本局。
  if (pottedNine || nineOffTable) spotNine(state)

  if (foul) {
    fouls[me] += 1
    state.nineFouls = fouls
    state.turn = op
    state.inHand = true
    if (state.cueIn || offTable.includes(0)) placeCue(state)
    if (fouls[me] >= 3) {
      finish(state, op, `连续${fouls[me]}次犯规判负`)
      return
    }
    state.message = `犯规:${foul}。${playerLabel(state, op)}自由球(俯视下可拖动白球)${
      fouls[me] > 0 ? ` · ${playerLabel(state, me)}已连续${fouls[me]}次犯规` : ''
    }`
    return
  }

  fouls[me] = 0
  state.nineFouls = fouls
  if (potted.length) {
    state.turn = me
    state.message = `进球!${playerLabel(state, me)}继续击球${
      targetN !== null ? ` · 目标:${nineTargetNumber(state)}号球` : ''
    }`
    return
  }
  state.turn = op
  state.message = `轮到${playerLabel(state, op)}击球 · 目标:${nineTargetNumber(state)}号球`
}

// 同分时复位黑球，抽签决定谁选先后手。
function startBlackOff(state) {
  const { geo } = state
  const black = state.balls.find((b) => b.n === 21)
  black.on = true
  place(geo, state.balls, black, ...colorSpot(geo, 21))
  placeCue(state)
  state.turn = Math.random() < 0.5 ? 0 : 1
  state.inHand = true
  state.breakShot = false
  state.sn.decider = true
  state.sn.onRed = false
  state.sn.idx = 5
  state.sn.finalColor = false
  state.sn.freeBall = null
  state.sn.choice = { kind: 'black', seat: state.turn, offender: 1 - state.turn }
  state.sn.missStreak = { seat: null, count: 0 }
  state.phase = 'choice'
  state.message = `平分，黑球复位，${playerLabel(
    state,
    state.turn,
  )}选择抢黑先后手`
}

function snookerTarget(state) {
  if (state.sn.decider) return '黑球'
  if (state.sn.freeBall) {
    const on = state.sn.onRed
      ? '红球'
      : state.sn.finalColor
        ? '任意彩球'
        : `${colorName(16 + state.sn.idx)}球`
    return `${colorName(state.sn.freeBall)}球(自由球，代${on})`
  }
  if (redsOnTable(state) > 0)
    return state.sn.onRed ? '红球' : '任意彩球'
  if (state.sn.finalColor) return '任意彩球'
  return ('黄绿棕蓝粉黑'[state.sn.idx] || '黑') + '球'
}

// 检查母球中心到与目标球接触的位置，排除终点以外的遮挡。
function pathClear(cue, blockers, angle, length, diameter) {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  return blockers.every((ball) => {
    const x = ball.x - cue.x
    const y = ball.y - cue.y
    const projection = Math.max(0, Math.min(length, x * dx + y * dy))
    return Math.hypot(x - projection * dx, y - projection * dy) >= diameter - 0.01
  })
}

function edgesClear(cue, target, blockers, diameter) {
  const x = target.x - cue.x
  const y = target.y - cue.y
  const distance = Math.hypot(x, y)
  if (distance <= diameter + 0.01) return true
  const angle = Math.atan2(y, x)
  const half = Math.asin(diameter / distance)
  const length = Math.sqrt(distance ** 2 - diameter ** 2)
  return pathClear(cue, blockers, angle - half, length, diameter) &&
    pathClear(cue, blockers, angle + half, length, diameter)
}

export function isSnookered(state, targets, blocker = null) {
  if (!targets.length) return false
  const { geo, balls } = state
  const candidates = new Set(targets.map((ball) => ball.n))
  const blockers = balls.filter((ball) => ball.on && ball.n && !candidates.has(ball.n))
  const clear = (cue, obstacles = blockers) => targets.some((target) =>
    edgesClear(cue, target, obstacles, 2 * geo.R),
  )
  if (blocker !== null) {
    const cue = balls[0]
    return !clear(cue) && clear(cue, blockers.filter((ball) => ball.n !== blocker))
  }
  if (!state.inHand) return !clear(balls[0])

  // 手中球须在整个 D 区都找不到直线球路，现有摆位只是其中之一。
  if (clear(balls[0])) return false
  const y0 = geo.H / 2
  const spacing = geo.R / 4
  for (let r = 0; r <= DR; r = Math.min(r + spacing, DR)) {
    const slices = Math.max(1, Math.ceil(Math.PI * r / spacing))
    for (let i = 0; i <= slices; i++) {
      const angle = Math.PI * (0.5 + i / slices)
      const cue = { x: BX + r * Math.cos(angle), y: y0 + r * Math.sin(angle) }
      if (free(geo, balls, cue.x, cue.y, balls[0]) && clear(cue)) return false
    }
    if (r === DR) break
  }
  return true
}

function spotSnookerColors(state, colors) {
  const { geo, balls } = state
  const spots = COLOR_VALUES.map((_, i) => colorSpot(geo, i + 16)).reverse()
  for (const n of colors.sort((a, b) => b - a)) {
    const ball = balls.find((b) => b.n === n)
    const own = colorSpot(geo, n)
    const point = [own, ...spots].find(([x, y]) => free(geo, balls, x, y, ball))
    if (point) {
      place(geo, balls, ball, ...point)
      continue
    }
    const directions = n >= 20 ? [1, -1] : [1]
    let spotted = false
    for (const direction of directions) {
      for (let x = own[0]; x >= geo.R && x <= geo.W - geo.R; x += direction) {
        if (!free(geo, balls, x, own[1], ball)) continue
        place(geo, balls, ball, x, own[1])
        spotted = true
        break
      }
      if (spotted) break
    }
    if (!spotted) place(geo, balls, ball, ...own)
  }
}

function pointsRemaining(balls, sn) {
  const reds = balls.filter((ball) => ball.on && ball.n >= 1 && ball.n <= 15).length
  const colors = balls.filter((ball) => ball.on && ball.n >= 16)
  const highest = Math.max(0, ...colors.map((ball) => colorValue(ball.n)))
  const clearance = colors.reduce((sum, ball) => sum + colorValue(ball.n), 0)
  const extra = sn.freeBall ? sn.onRed ? 1 + highest : colorValue(16 + sn.idx) : 0
  return reds * (1 + highest) + clearance + (!sn.onRed && (reds || sn.finalColor) ? highest : 0) + extra
}

export function snookerPointsRemaining(state) {
  return pointsRemaining(state.balls, state.sn)
}

function canHitFullBall(state, targets) {
  const balls = state.shotStart?.balls
  if (!balls) return false
  const cue = balls[0]
  const diameter = 2 * state.geo.R
  return targets.some((ball) => {
    const distance = Math.hypot(ball.x - cue.x, ball.y - cue.y)
    if (distance <= diameter + 0.05) return true
    const blockers = balls.filter((other) => other.on && other.n &&
      other.n !== ball.n && (ball.n > 15 || other.n > 15))
    if (ball.n <= 15) return edgesClear(cue, ball, blockers, diameter)
    return pathClear(cue, blockers, Math.atan2(ball.y - cue.y, ball.x - cue.x),
      distance - diameter, diameter)
  })
}

export function concedeFrame(state, seat) {
  if (!state || state.phase === 'over') return state
  finish(state, 1 - seat, `${playerLabel(state, seat)}认输`)
  state.sn.choice = null
  return state
}

export function offerConcession(state, seat) {
  state.sn.choice = { kind: 'concede', seat: 1 - seat, offender: seat }
  state.phase = 'choice'
  state.message = `${playerLabel(state, seat)}提出认输`
}

export function resolveSnookerChoice(state, decision, freeBall = null) {
  const choice = state.sn && state.sn.choice
  if (!choice) return state
  if (choice.kind === 'black' || choice.kind === 'concede') {
    state.sn.choice = null
    if (choice.kind === 'concede' && decision === 'play') return concedeFrame(state, choice.offender)
    state.turn = decision === 'again' ? choice.offender : choice.seat
    if (choice.kind === 'black') state.sn.blackOpener = state.turn
    state.phase = 'aim'
    state.message = `${playerLabel(state, state.turn)}继续击球 · 目标:${snookerTarget(state)}`
    return state
  }
  const snapshot = choice.snapshot
  state.sn.freeBall = null
  if (decision === 'replay' && choice.miss && snapshot) {
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
    )}重打 · 球位已恢复 · 目标:${snookerTarget(state)}${choice.warn ? ' · 再次未击中将判负' : ''}`
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
  const { geo } = state
  const me = state.turn
  const op = 1 - me
  state.breakShot = false
  const freeBall = state.sn.freeBall
  const potted = state.potted
  const offTable = state.offTable || []
  const cueOff = state.cueIn || offTable.includes(0)
  const redsAtStart = redsOnTable(state) +
    [...potted, ...offTable].filter((n) => n >= 1 && n <= 15).length > 0
  const finalColor = !!state.sn.finalColor
  const nextColor = state.sn.decider ? 21 : 16 + state.sn.idx
  const redOn = redsAtStart && state.sn.onRed
  const anyColorOn = !redOn && (redsAtStart || finalColor)
  const firstHits = state.firstHits?.length ? state.firstHits
    : state.firstHit === null ? [] : [state.firstHit]
  const startingBalls = state.shotStart?.balls || state.balls
  const cueAtStart = startingBalls[0]
  const touching = startingBalls.filter((b) => b.on && b.n &&
    Math.hypot(b.x - cueAtStart.x, b.y - cueAtStart.y) <= 2 * geo.R + 0.05)
  const direction = (ball) => Math.cos(state.shotAngle) * (ball.x - cueAtStart.x) +
    Math.sin(state.shotAngle) * (ball.y - cueAtStart.y)
  // 打离贴着的彩球时，即使没有再碰到球，也视为击中了这颗彩球。
  const targetColor = anyColorOn
    ? firstHits.find((n) => n >= 16) ?? touching.find((ball) => ball.n >= 16 && direction(ball) <= 0)?.n
    : nextColor
  const isBallOn = (n) => redOn ? n > 0 && n <= 15 : n === targetColor
  const ballOnValue = redOn ? 1 : colorValue(targetColor) ?? 4
  const movedTouchingBall = touching.find((ball) => firstHits.includes(ball.n) && direction(ball) > 0)
  const playedAway = !freeBall && touching.some((ball) => isBallOn(ball.n) && direction(ball) <= 0)
  const contactedOn = playedAway || (freeBall ? firstHits.includes(freeBall) : firstHits.some(isBallOn))
  const legalContact = playedAway || (contactedOn && firstHits.every((n) => n === freeBall || isBallOn(n)))
  let why = movedTouchingBall ? '击动了贴球'
    : state.cueIn ? '白球落袋'
    : offTable.length ? '有球离开台面'
    : !legalContact ? firstHits.length ? '先碰了错误的球' : '未击中任何球'
    : ''
  let foulValue = Math.max(4, ballOnValue, movedTouchingBall ? colorValue(movedTouchingBall.n) : 0)
  for (const n of offTable) foulValue = Math.max(foulValue, colorValue(n) || 0)
  if (!legalContact)
    for (const n of firstHits)
      foulValue = Math.max(foulValue, n === freeBall ? ballOnValue : colorValue(n))

  let points = 0
  const trueBallPotted = potted.some(isBallOn)
  for (const n of potted) {
    if (isBallOn(n)) points += colorValue(n)
    else if (n === freeBall) {
      if (redOn || !trueBallPotted) points += ballOnValue
    } else {
      why ||= '打进了错误的球'
      foulValue = Math.max(foulValue, colorValue(n))
    }
  }

  if (!why && !points && freeBall &&
      state.balls.filter((ball) => ball.on && ball.n).length > 2 &&
      isSnookered(state, state.balls.filter((ball) => ball.on && isBallOn(ball.n)), freeBall))
    why = '用指定自由球给对手做斯诺克'

  const foul = !!why
  const onlyBlack = !redOn && !anyColorOn &&
    startingBalls.filter((ball) => ball.on && ball.n).every((ball) => ball.n === 21)
  state.sn.freeBall = null
  spotSnookerColors(state, [...potted, ...offTable].filter((n) => n >= 16 &&
    (redsAtStart || finalColor || foul || n === freeBall)))
  if (cueOff) placeCue(state)
  let txt = ''

  if (foul) {
    const streak = state.sn.missStreak || { seat: null, count: 0 }
    const continuing = streak.seat === me && streak.count > 0
    const startTargets = startingBalls.filter((b) => b.on && b.n && (
      freeBall ? b.n === freeBall : anyColorOn ? b.n >= 16 : isBallOn(b.n)
    ))
    const fullBall = canHitFullBall(state, startTargets)
    const maxBefore = pointsRemaining(startingBalls, { ...state.sn, freeBall })
    const differenceBefore = Math.abs(state.sn.score[0] - state.sn.score[1])

    state.sn.score[op] += foulValue
    state.turn = op
    state.inHand = cueOff
    state.sn.onRed = redsOnTable(state) > 0
    state.sn.finalColor = false
    if (redsAtStart || finalColor) state.sn.idx = 0

    const differenceAfter = Math.abs(state.sn.score[0] - state.sn.score[1])
    const targets = state.balls.filter((b) => b.on && b.n && (
      state.sn.onRed ? b.n <= 15 : b.n === 16 + state.sn.idx
    ))
    const freeAward = isSnookered(state, targets)
    const maxAfter = snookerPointsRemaining(state) + (freeAward
      ? state.sn.onRed ? 8 : colorValue(16 + state.sn.idx)
      : 0)
    const needsPenalties = differenceBefore > maxBefore || differenceAfter > maxAfter
    // 无人工裁判，需罚分后只延续已经开始的满球复位序列。
    const isMiss = !onlyBlack && !contactedOn && (continuing || !needsPenalties)
    const count = isMiss && fullBall ? (continuing ? streak.count + 1 : 1) : 0
    state.sn.missStreak = count ? { seat: me, count } : { seat: null, count: 0 }
    if (count >= 3) {
      state.sn.choice = null
      finish(state, op, '三次未击中目标球判负')
      return
    }
    const warn = count === 2
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
    if (warn) txt += ' · 若再回原位重打，未击中将判负'
    state.phase = state.sn.choice ? 'choice' : 'aim'
  } else {
    state.sn.missStreak = { seat: null, count: 0 }
    state.sn.score[me] += points
    const pottedFree = potted.includes(freeBall)
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
      if (!pottedFree || trueBallPotted) state.sn.idx++
      txt = `进球+${points}分,继续击球`
    } else {
      state.turn = op
      txt = `未进球,轮到${playerLabel(state, op)}`
    }
    state.sn.choice = null
    state.phase = 'aim'
  }

  // 只剩黑球时，第一次进球或犯规即结束本局；同分则黑球复位决胜。
  if (foul && onlyBlack) {
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

  const live = state.balls.filter((ball) => ball.on && ball.n)
  const [a, b] = state.sn.score
  if (!state.sn.finalColor && live.length === 1 && live[0].n === 21 && Math.abs(a - b) > 7) {
    state.sn.choice = null
    finish(state, a > b ? 0 : 1, `只剩黑球，分差超过7分 (${a} : ${b})`)
    return
  }
  state.message = txt + ' · 目标:' + snookerTarget(state)
}

export function endShot(state) {
  if (state.mode === 'pool') endPool(state)
  else if (state.mode === 'nine') endNine(state)
  else endSnooker(state)
  state.quietShots = state.phase === 'aim' && !state.inHand &&
    !state.potted.length && !state.offTable?.length
    ? (state.quietShots ?? 0) + 1
    : 0
}

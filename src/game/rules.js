import { cueSpot, colorSpot } from './geometry.js'
import { place } from './physics.js'

const STRIPE_THRESHOLD = 8

export const isStripe = (n) => (n < STRIPE_THRESHOLD ? 'solid' : 'stripe')
export const playerLabel = (state, seat) =>
  (state.names && state.names[seat]) || `玩家${seat + 1}`

const COLOR_VALUES = [2, 3, 4, 5, 6, 7]
const colorValue = (n) => (n <= 15 ? 1 : COLOR_VALUES[n - 16])
const redsOnTable = (state) =>
  state.balls.filter((b) => b.on && b.n >= 1 && b.n <= 15).length

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

  if (state.potted.includes(8)) {
    if (state.breakShot) {
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

  const wasBreak = state.breakShot
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
  const continues =
    !foul &&
    (wasBreak
      ? state.potted.some((n) => n !== 8)
      : own && state.potted.some((n) => n !== 8 && isStripe(n) === own))

  if (state.cueIn) place(geo, state.balls, state.balls[0], ...cueSpot(geo))
  state.breakShot = false

  if (foul) {
    state.turn = op
    state.inHand = true
    txt += `犯规:${foul}。${playerLabel(
      state,
      op,
    )}自由球(俯视下可拖动白球)`
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

function snookerTarget(state) {
  if (redsOnTable(state) > 0)
    return state.sn.onRed ? '红球' : '任意彩球'
  if (state.sn.finalColor) return '任意彩球'
  return ('黄绿棕蓝粉黑'[state.sn.idx] || '黑') + '球'
}

export function resolveSnookerChoice(state, decision) {
  const choice = state.sn && state.sn.choice
  if (!choice) return state
  const snapshot = choice.snapshot
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
    state.breakShot = snapshot.breakShot
    state.canEight = snapshot.canEight
    // 目标球不跟随快照恢复，而是按犯规后的正常顺序重新判定：
    // 对手刚打完一颗红球、正在打彩球时犯规，重打应从红球开始，
    // 不能沿用犯规那一杆的彩球目标。
    state.message = `${playerLabel(
      state,
      state.turn,
    )}重打 · 球位已恢复 · 目标:${snookerTarget(state)}`
  } else {
    state.turn = choice.seat
    state.message = `${playerLabel(
      state,
      choice.seat,
    )}击球 · 目标:${snookerTarget(state)}`
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
  const pottedReds = state.potted.filter((n) => n <= 15).length
  const redsAtStart = redsOnTable(state) + pottedReds > 0
  const finalColor = !!state.sn.finalColor
  const nextColor = 16 + state.sn.idx
  const first = state.firstHit

  let foul = state.cueIn || first === null
  let why = state.cueIn
    ? '白球落袋'
    : first === null
      ? '未击中任何球'
      : ''
  let points = 0
  let txt = ''

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
    const legalFirst = redsAtStart
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

  for (const n of state.potted) {
    const legal = redsAtStart
      ? state.sn.onRed
        ? n <= 15
        : n === first && n >= 16
      : finalColor
        ? n === first && n >= 16
        : n === nextColor
    if (legal) points += colorValue(n)
    else {
      foul = true
      foulValue = Math.max(foulValue, colorValue(n))
      why = why || '打进了错误的球'
    }
  }

  // 彩球复位：红球阶段、最后一颗红球后的那颗彩球、以及犯规打进的彩球。
  for (const n of state.potted)
    if (n >= 16 && (redsAtStart || finalColor || foul))
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
      if (redsAtStart || finalColor) {
        // 红球阶段或最后一颗红球后的彩球阶段犯规：从黄球重新开始。
        state.sn.idx = 0
        state.sn.finalColor = false
      }
    }
    txt = `犯规:${why},${playerLabel(state, op)}得${foulValue}分`
    state.sn.choice = state.shotStart
      ? { seat: op, offender: me, snapshot: state.shotStart }
      : null
    if (state.sn.choice) txt += ' · 可选择自己击球或让对手重打'
    state.phase = state.sn.choice ? 'choice' : 'aim'
  } else {
    state.sn.score[me] += points
    if (redsAtStart) {
      if (state.sn.onRed) {
        if (state.potted.some((n) => n <= 15)) {
          state.sn.finalColor =
            redsOnTable(state) === 0
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
    } else if (state.potted.includes(nextColor)) {
      state.sn.idx++
      if (state.sn.idx <= 5) txt = `进球+${points}分,继续击球`
    } else {
      state.turn = op
      txt = `未进球,轮到${playerLabel(state, op)}`
    }
    state.sn.choice = null
    state.phase = 'aim'
  }

  if (state.sn.idx > 5) {
    const a = state.sn.score[0]
    const b = state.sn.score[1]
    finish(state, a === b ? -1 : a > b ? 0 : 1, `${a} : ${b}`)
    return
  }

  state.message = txt + ' · 目标:' + snookerTarget(state)
}

export function endShot(state) {
  if (state.mode === 'pool') endPool(state)
  else endSnooker(state)
}

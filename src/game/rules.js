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

function endSnooker(state) {
  const { geo } = state
  const me = state.turn
  const op = 1 - me
  state.breakShot = false
  const redsLeft =
    redsOnTable(state) + state.potted.filter((n) => n <= 15).length > 0
  const nextColor = 16 + state.sn.idx
  const first = state.firstHit

  let foul = state.cueIn || first === null
  let foulValue = 4
  let why = state.cueIn
    ? '白球落袋'
    : first === null
      ? '未击中任何球'
      : ''
  let points = 0
  let txt = ''

  if (
    first !== null &&
    !(redsLeft ? (state.sn.onRed ? first <= 15 : first >= 16) : first === nextColor)
  ) {
    foul = true
    foulValue = Math.max(foulValue, colorValue(first))
    why = '先碰了错误的球'
  }

  for (const n of state.potted) {
    if (redsLeft ? (state.sn.onRed ? n <= 15 : n === first) : n === nextColor)
      points += colorValue(n)
    else {
      foul = true
      foulValue = Math.max(foulValue, colorValue(n))
      why = why || '打进了错误的球'
    }
  }

  for (const n of state.potted)
    if (n >= 16 && (redsLeft || foul))
      place(geo, state.balls, state.balls.find((b) => b.n === n), ...colorSpot(geo, n))
  if (state.cueIn) place(geo, state.balls, state.balls[0], ...cueSpot(geo))

  const last = !redsLeft && state.potted.includes(21)
  if (foul) {
    state.sn.score[op] += foulValue
    state.turn = op
    state.sn.onRed = true
    state.inHand = state.cueIn
    txt = `犯规:${why},${playerLabel(state, op)}得${foulValue}分`
  } else {
    state.sn.score[me] += points
    if (state.potted.length) {
      if (redsLeft) state.sn.onRed = !state.sn.onRed
      else state.sn.idx++
      txt = `进球+${points}分,继续击球`
    } else {
      state.turn = op
      state.sn.onRed = true
      txt = `未进球,轮到${playerLabel(state, op)}`
    }
  }

  if (last || state.sn.idx > 5) {
    const a = state.sn.score[0]
    const b = state.sn.score[1]
    finish(state, a === b ? -1 : a > b ? 0 : 1, `${a} : ${b}`)
    return
  }

  state.message =
    txt +
    ' · 目标:' +
    (redsOnTable(state) > 0
      ? state.sn.onRed
        ? '红球'
        : '任意彩球'
      : '黄绿棕蓝粉黑'[state.sn.idx] + '球')
}

export function endShot(state) {
  if (state.mode === 'pool') endPool(state)
  else endSnooker(state)
}

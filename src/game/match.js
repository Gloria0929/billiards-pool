import { MAX_SIM_STEPS, MODES, clamp } from './constants.js'
import { colorSpot, cueSpot, getGeometry } from './geometry.js'
import { canPlaceCue, frozenCushions, placeCue, moving, step } from './physics.js'
import { acceptLineBallInHand, endShot, playerLabel, resolveSnookerChoice } from './rules.js'

const BREAK_SPEED_BOOST = 2.3

const makeBall = (n, x, y, phys = null) => ({
  n,
  x,
  y,
  vx: 0,
  vy: 0,
  wx: 0,
  wy: 0,
  wz: 0,
  on: true,
  st: 0,
  q: null,
  fallSpin: null,
  m: phys ? phys.m : 1,
  mu: phys ? phys.mu : 1,
})

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function buildBalls(mode, rng, geo) {
  const { W, H, R } = geo
  // 开球球型随机化：全部由 seed 决定，联网双方摆球一致。
  // 1) 整座三角架有约 ±3° 的旋转和整体偏移，改变白球撞到第一颗球时的接触点；
  // 2) 每颗球有约 ±0.08 个球半径的位置误差（真实摆球也不可能完全整齐）；
  // 3) 每颗球有微小质量 / 摩擦差异，让碰撞链逐局发散，
  //    开球后球停在哪里不再每次都差不多。
  const rackTheta = (rng() - 0.5) * 0.1
  const rackShiftX = (rng() - 0.5) * R * 0.4
  const rackShiftY = (rng() - 0.5) * R * 0.8
  const cosT = Math.cos(rackTheta)
  const sinT = Math.sin(rackTheta)
  const jit = () => (rng() - 0.5) * R * 0.16
  const rackPoint = (head, lx, ly) => [
    head + cosT * lx - sinT * ly + rackShiftX,
    H / 2 + sinT * lx + cosT * ly + rackShiftY,
  ]
  const ballPhys = () => ({
    m: 1 + (rng() - 0.5) * 0.06,
    mu: 1 + (rng() - 0.5) * 0.12,
  })
  let balls

  if (mode === 'pool') {
    const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]
    shuffle(rest, rng)
    const slots = new Array(15)
    let k = 0
    for (let i = 0; i < 15; i++) slots[i] = i === 4 ? 8 : rest[k++]
    const typeOf = (n) => (n < 8 ? 0 : 1)
    while (typeOf(slots[10]) === typeOf(slots[14])) {
      const candidates = [0, 1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13].filter(
        (i) => typeOf(slots[i]) !== typeOf(slots[14]),
      )
      const pick = candidates[Math.floor(rng() * candidates.length)]
      ;[slots[14], slots[pick]] = [slots[pick], slots[14]]
    }
    balls = [makeBall(0, ...cueSpot(geo))]
    const head = W * 0.72
    const dx = R * Math.sqrt(3) * 1.002
    let idx = 0
    for (let row = 0; row < 5; row++)
      for (let col = 0; col <= row; col++)
        balls.push(
          makeBall(
            slots[idx++],
            ...rackPoint(
              head,
              row * dx + jit(),
              (col - row / 2) * 2 * R * 1.002 + jit(),
            ),
            ballPhys(),
          ),
        )
  } else {
    balls = [makeBall(0, ...cueSpot(geo))]
    for (let n = 16; n < 22; n++) balls.push(makeBall(n, ...colorSpot(geo, n)))
    const head = W * 0.75 + 2 * R * 1.02
    const dx = R * Math.sqrt(3) * 1.002
    let n = 1
    for (let row = 0; row < 5; row++)
      for (let col = 0; col <= row; col++)
        balls.push(
          makeBall(
            n++,
            ...rackPoint(
              head,
              row * dx + jit(),
              (col - row / 2) * 2 * R * 1.002 + jit(),
            ),
            ballPhys(),
          ),
        )
  }
  return balls
}

export function createMatch(mode, seed = (Math.random() * 2 ** 32) >>> 0, names = null) {
  const geo = getGeometry(mode)
  const rng = mulberry32(seed >>> 0)
  const balls = buildBalls(mode, rng, geo)

  return {
    version: 1,
    mode,
    seed: seed >>> 0,
    names: names
      ? names.map((name, index) =>
          name ? String(name).slice(0, 16) : `玩家${index + 1}`,
        )
      : null,
    geo,
    balls,
    turn: 0,
    opener: 0,
    quietShots: 0,
    grp: [null, null],
    inHand: true,
    inHandLine: false,
    breakShot: true,
    canEight: false,
    firstHit: null,
    potted: [],
    cueIn: false,
    railBalls: [],
    railAfterContact: false,
    breakCrossed: [],
    breakChoice: null,
    breakMisses: [0, 0],
    sn: {
      score: [0, 0],
      onRed: true,
      idx: 0,
      finalColor: false,
      choice: null,
      freeBall: null,
      missStreak: { seat: null, count: 0 },
      decider: false,
    },
    phase: 'aim',
    message: `${(names && names[0]) || '玩家1'} 开球 · 拖动白球摆位，轻点台面瞄准`,
    winner: null,
    events: [],
    shotAnchor: null,
    shotStart: null,
  }
}

// 开球失机后按乔氏规则重新摆球，由指定一方重新开球。
export function rerackPool(state, breakerSeat = 0) {
  if (!state || state.mode !== 'pool') return state
  const geo = state.geo || getGeometry('pool')
  const seed = (Math.random() * 2 ** 32) >>> 0
  state.balls = buildBalls('pool', mulberry32(seed), geo)
  state.seed = seed
  state.turn = state.opener = breakerSeat === 1 ? 1 : 0
  state.quietShots = 0
  state.grp = [null, null]
  state.inHand = true
  state.inHandLine = true
  state.breakShot = true
  state.canEight = false
  state.firstHit = null
  state.potted = []
  state.cueIn = false
  state.railBalls = []
  state.railAfterContact = false
  state.events = []
  state.shotAnchor = null
  state.shotStart = null
  state.winner = null
  state.breakChoice = null
  state.phase = 'aim'
  state.message = `${playerLabel(
    state,
    state.turn,
  )} 重新开球 · 拖动白球摆位，轻点台面瞄准`
  return state
}

export function resolveBreakChoice(state, decision, breakerSeat = null) {
  const choice = state && state.breakChoice
  if (!choice) return state
  if (decision === 'rerack') {
    const seat = choice.kind === 'eight' ? choice.seat : breakerSeat
    return rerackPool(state, seat === choice.seat ? seat : choice.offender)
  }
  if (choice.kind === 'no-contact') return state
  state.breakChoice = null
  state.turn = choice.seat
  state.inHand = false
  state.inHandLine = false
  state.breakShot = false
  state.firstHit = null
  state.potted = []
  state.cueIn = false
  state.phase = 'aim'
  if (choice.kind === 'foul') acceptLineBallInHand(state)
  state.message = `${playerLabel(state, choice.seat)}${state.inHandLine ? '获得线后自由球' : '接受台面,继续击球'}`
  return state
}

export function offerStalemate(state) {
  state.sn.choice = { kind: 'stalemate', seat: 1 - state.turn, offender: state.turn }
  state.phase = 'choice'
  state.message = `${playerLabel(state, state.turn)}提议本局重摆`
}

export function resolveFrameChoice(state, decision, freeBall) {
  if (state.sn.choice?.kind !== 'stalemate') return resolveSnookerChoice(state, decision, freeBall)
  state.sn.choice = null
  if (decision !== 'play') {
    state.phase = 'aim'
    state.message = `${playerLabel(state, state.turn)}继续击球`
    return state
  }
  if (state.mode === 'pool') return rerackPool(state, state.opener)
  if (state.sn.decider) {
    const black = state.balls.find((ball) => ball.n === 21)
    ;[black.x, black.y] = colorSpot(state.geo, 21)
    placeCue(state)
    state.inHand = true
    state.phase = 'aim'
    state.turn = state.sn.blackOpener ?? state.turn
    state.quietShots = 0
    state.message = `${playerLabel(state, state.turn)}重开抢黑`
    return state
  }
  const restarted = createMatch(state.mode, undefined, state.names)
  restarted.turn = restarted.opener = state.opener
  restarted.message = `${playerLabel(restarted, restarted.opener)}重新开球`
  return restarted
}

function captureShotStart(state) {
  return {
    balls: state.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, on: b.on })),
    turn: state.turn,
    grp: [...state.grp],
    inHand: state.inHand,
    inHandLine: state.inHandLine,
    breakShot: state.breakShot,
    canEight: state.canEight,
    sn: {
      onRed: state.sn.onRed,
      idx: state.sn.idx,
      finalColor: state.sn.finalColor,
      freeBall: state.sn.freeBall,
    },
  }
}

export function launchShot(state, shot) {
  const geo = state.geo
  const { R } = geo
  const cue = state.balls[0]
  const angle = Number.isFinite(shot.angle) ? shot.angle : 0
  const power = clamp(Number.isFinite(shot.power) ? shot.power : 0.45, 0, 1)
  const spin = {
    x: clamp(Number.isFinite(shot.spin?.x) ? shot.spin.x : 0, -0.65, 0.65),
    y: clamp(Number.isFinite(shot.spin?.y) ? shot.spin.y : 0, -0.65, 0.65),
  }

  if (state.inHand && shot.cue && canPlaceCue(state, shot.cue.x, shot.cue.y)) {
    cue.x = shot.cue.x
    cue.y = shot.cue.y
    cue.on = true
  }
  if (!cue.on || (state.inHand && !canPlaceCue(state, cue.x, cue.y))) placeCue(state)
  cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0
  cue.st = 0
  cue.q = null

  const group = state.grp[state.turn]
  state.canEight =
    !!group &&
    state.balls.every(
      (b) => !b.on || b.n === 0 || b.n === 8 || (b.n < 8 ? 'solid' : 'stripe') !== group,
    )

  // 记录出杆前的球位与目标状态，供斯诺克犯规后的“重打 / 复位”使用。
  state.shotStart = captureShotStart(state)
  state.nominatedColor = shot.nominatedColor ?? null
  state.shotAngle = angle

  const speed =
    ((200 + power * 8300) * (state.breakShot ? BREAK_SPEED_BOOST : 1)) /
    (1 + 0.9 * (spin.x * spin.x + spin.y * spin.y))
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const side = spin.y / 0.4
  cue.vx = dx * speed
  cue.vy = dy * speed
  cue.wx = ((-dy * speed) / R) * side
  cue.wy = ((dx * speed) / R) * side
  cue.wz = ((spin.x * speed) / (0.4 * R)) * 0.6

  state.events = []
  state.firstHit = null
  state.firstHits = []
  state.potted = []
  state.cueIn = false
  state.railBalls = []
  state.railAfterContact = false
  state.breakCrossed = []
  state.frozenRails = state.mode === 'pool' && !state.breakShot
    ? frozenCushions(geo, state.balls)
    : null
  state.offTable = []
  state.cueCrossedLine = false
  state.inHand = false
  state.inHandLine = false
  state.phase = 'moving'
  state.shotAnchor = { x: cue.x, y: cue.y }
  state.winner = null
  return state
}

export function simulateShot(state, shot) {
  launchShot(state, shot)
  let guard = 0
  while (moving(state.balls) && guard++ < MAX_SIM_STEPS) step(state)
  state.shotAnchor = null
  state.phase = 'aim'
  endShot(state)
  return state
}

export function publicState(state) {
  return {
    version: 1,
    mode: state.mode,
    seed: state.seed,
    names: state.names,
    balls: state.balls.map((b) => ({
      n: b.n,
      x: b.x,
      y: b.y,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      on: b.on,
      st: 0,
      q: null,
      m: b.m || 1,
      mu: b.mu || 1,
    })),
    turn: state.turn,
    opener: state.opener,
    quietShots: state.quietShots,
    grp: [...state.grp],
    inHand: state.inHand,
    inHandLine: state.inHandLine,
    breakShot: state.breakShot,
    canEight: state.canEight,
    firstHit: state.firstHit,
    potted: [...state.potted],
    cueIn: state.cueIn,
    breakChoice: state.breakChoice
      ? {
          seat: state.breakChoice.seat,
          offender: state.breakChoice.offender,
          kind: state.breakChoice.kind || 'miss',
        }
      : null,
    breakMisses: [...(state.breakMisses || [0, 0])],
    sn: {
      score: [...state.sn.score],
      onRed: state.sn.onRed,
      idx: state.sn.idx,
      finalColor: !!state.sn.finalColor,
      choice: state.sn.choice
        ? {
            seat: state.sn.choice.seat,
            offender: state.sn.choice.offender,
            freeBall: !!state.sn.choice.freeBall,
            miss: !!state.sn.choice.miss,
            warn: !!state.sn.choice.warn,
          kind: state.sn.choice.kind ?? null,
          }
        : null,
      freeBall: state.sn.freeBall || null,
      missStreak: { ...state.sn.missStreak },
      decider: !!state.sn.decider,
      blackOpener: state.sn.blackOpener ?? null,
    },
    phase: state.phase,
    message: state.message,
    winner: state.winner,
  }
}

export function hydrateState(data) {
  const state = data
  state.geo = getGeometry(state.mode)
  state.events = state.events || []
  state.names = state.names || null
  state.balls.forEach((b) => {
    b.st = b.st || 0
    b.q = b.q || null
    b.fallSpin = b.fallSpin || null
    b.wz = b.wz || 0
    b.m = b.m || 1
    b.mu = b.mu || 1
  })
  state.sn = state.sn || { score: [0, 0], onRed: true, idx: 0 }
  state.sn.finalColor = !!state.sn.finalColor
  state.sn.choice = state.sn.choice || null
  state.sn.freeBall = state.sn.freeBall || null
  state.sn.missStreak = state.sn.missStreak || { seat: null, count: 0 }
  state.sn.decider = !!state.sn.decider
  state.opener ??= 0
  state.quietShots ??= 0
  state.inHandLine = !!state.inHandLine
  state.breakChoice = state.breakChoice || null
  state.breakMisses = Array.isArray(state.breakMisses)
    ? state.breakMisses
    : [0, 0]
  return state
}

export function snapshot(state) {
  if (!state) return null
  return {
    mode: state.mode,
    modeName: MODES[state.mode]?.name ?? '中式八球',
    phase: state.phase,
    turn: state.turn,
    winner: state.winner,
    message: state.message,
    groups: [...state.grp],
    scores: [...state.sn.score],
    onRed: state.sn.onRed,
    colorIndex: state.sn.idx,
    finalColor: !!state.sn.finalColor,
    inHand: state.inHand,
    breakShot: state.breakShot,
    names: state.names ? [...state.names] : null,
    balls: state.balls.map((b) => ({ n: b.n, on: b.on })),
  }
}

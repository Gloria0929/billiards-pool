import { MAX_SIM_STEPS, MODES, clamp } from './constants.js'
import { colorSpot, cueSpot, getGeometry } from './geometry.js'
import { place, moving, step } from './physics.js'
import { endShot } from './rules.js'

const makeBall = (n, x, y) => ({
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

export function createMatch(mode, seed = (Math.random() * 2 ** 32) >>> 0, names = null) {
  const geo = getGeometry(mode)
  const rng = mulberry32(seed >>> 0)
  const { W, H, R } = geo
  // 摆球随机偏移：三角架每颗球加约 0.02 个球直径的随机偏移（用 seed 随机数，
  // 同 seed 仍可复现，联网对局两边一致）。偏移肉眼不可见，但碰撞链会放大它，
  // 使每局开球后球形各不相同；不改出杆参数，不影响玩家瞄准。
  const jit = () => (rng() - 0.5) * R * 0.04
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
            head + row * dx + jit(),
            H / 2 + (col - row / 2) * 2 * R * 1.002 + jit(),
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
            head + row * dx + jit(),
            H / 2 + (col - row / 2) * 2 * R * 1.002 + jit(),
          ),
        )
  }

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
    grp: [null, null],
    inHand: true,
    breakShot: true,
    canEight: false,
    firstHit: null,
    potted: [],
    cueIn: false,
    sn: { score: [0, 0], onRed: true, idx: 0 },
    phase: 'aim',
    message: `${(names && names[0]) || '玩家1'} 开球 · 拖动白球摆位，轻点台面瞄准`,
    winner: null,
    events: [],
    shotAnchor: null,
  }
}

export function launchShot(state, shot) {
  const geo = state.geo
  const { R, W, H } = geo
  const cue = state.balls[0]
  const angle = Number.isFinite(shot.angle) ? shot.angle : 0
  const power = clamp(Number.isFinite(shot.power) ? shot.power : 0.45, 0, 1)
  const spin = {
    x: clamp(Number.isFinite(shot.spin?.x) ? shot.spin.x : 0, -0.65, 0.65),
    y: clamp(Number.isFinite(shot.spin?.y) ? shot.spin.y : 0, -0.65, 0.65),
  }

  if (state.inHand && shot.cue && Number.isFinite(shot.cue.x) && Number.isFinite(shot.cue.y)) {
    const x = clamp(shot.cue.x, 0, W)
    const y = clamp(shot.cue.y, 0, H)
    cue.x = x
    cue.y = y
    if (!cue.on) cue.on = true
    place(geo, state.balls, cue, x, y)
  }
  if (!cue.on) {
    cue.on = true
    cue.x = cueSpot(geo)[0]
    cue.y = cueSpot(geo)[1]
  }
  cue.vx = cue.vy = cue.wx = cue.wy = cue.wz = 0
  cue.st = 0
  cue.q = null

  const group = state.grp[state.turn]
  state.canEight =
    !!group &&
    state.balls.every(
      (b) => !b.on || b.n === 0 || b.n === 8 || (b.n < 8 ? 'solid' : 'stripe') !== group,
    )

  const speed = (200 + power * 8300) / (1 + 0.9 * (spin.x * spin.x + spin.y * spin.y))
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
  state.potted = []
  state.cueIn = false
  state.inHand = false
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
    })),
    turn: state.turn,
    grp: [...state.grp],
    inHand: state.inHand,
    breakShot: state.breakShot,
    canEight: state.canEight,
    firstHit: state.firstHit,
    potted: [...state.potted],
    cueIn: state.cueIn,
    sn: {
      score: [...state.sn.score],
      onRed: state.sn.onRed,
      idx: state.sn.idx,
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
  })
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
    inHand: state.inHand,
    breakShot: state.breakShot,
    names: state.names ? [...state.names] : null,
    balls: state.balls.map((b) => ({ n: b.n, on: b.on })),
  }
}

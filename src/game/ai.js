import { getGeometry } from './geometry.js'
import { castRay, moving, step } from './physics.js'
import { launchShot, simulateShot } from './match.js'
import { canNominateColor } from './rules.js'

const SOLIDS = 'solid'

// 人机对战 AI 难度：angle/power/safety 是误差的满幅（实际误差为 ±一半），
// randomPick 是不挑最近可进球、改从全部可进球里随机挑的概率。
// hard 还会优先挑切角小、距离短、成功率最高的球，并在击球前用物理模拟
// 比较几种加塞 / 高低杆，选进球且白球走位最好的那一种（见 chooseAiShot）。
// normal 与改动前的固定水平完全一致。
export const AI_DIFFICULTY = {
  easy: { angle: 0.032, power: 0.2, safety: 0.08, randomPick: 0.3 },
  normal: { angle: 0.008, power: 0.04, safety: 0.02, randomPick: 0 },
  hard: { angle: 0.004, power: 0.02, safety: 0.01, randomPick: 0 },
}

// 困难 AI 在出杆前试打的旋转组合：左右塞、高杆、低杆。
const HARD_SPINS = [
  { x: 0, y: 0 },
  { x: 0.4, y: 0 },
  { x: -0.4, y: 0 },
  { x: 0, y: 0.35 },
  { x: 0, y: -0.35 },
]

// 在状态副本上试打一杆，返回是否进球 / 白球是否落袋 / 白球走位分。
function trialShot(state, shot, targetN) {
  const trial = structuredClone({ ...state, geo: null, events: [] })
  trial.geo = state.geo
  trial.events = []
  simulateShot(trial, shot)
  const cue = trial.balls[0]
  let nearest = Infinity
  for (const ball of trial.balls) {
    if (ball === cue || !ball.on) continue
    nearest = Math.min(
      nearest,
      Math.hypot(ball.x - cue.x, ball.y - cue.y),
    )
  }
  const { W, H } = trial.geo
  const railGap = Math.min(cue.x, W - cue.x, cue.y, H - cue.y)
  const position = Math.min(railGap, 420) * 1.2 + Math.min(nearest, 260)
  return {
    potted: trial.potted.includes(targetN),
    scratch: trial.cueIn,
    score:
      (trial.potted.includes(targetN) ? 10000 : 0) +
      (trial.cueIn || !cue.on ? -6000 : 0) +
      (cue.on ? position : 0),
  }
}

function groupOf(n) {
  return n < 8 ? SOLIDS : 'stripe'
}

// 只模拟到第一次碰到球，用于寻找解球线路（比跑完整杆快得多）。
function firstContactNumber(state, shot, legal) {
  const trial = structuredClone({ ...state, geo: null, events: [] })
  trial.geo = state.geo
  trial.events = []
  launchShot(trial, shot)
  let guard = 0
  while (guard++ < 1800) {
    step(trial)
    if (trial.cueIn) return null
    if (trial.firstHit !== null)
      return legal.has(trial.firstHit) ? trial.firstHit : null
    if (!moving(trial.balls)) break
  }
  return null
}

// 被做斯诺克时扫描一圈出杆角度，找一条能先碰到合法目标的线路（可借库）。
function findEscapeShot(state, targets, difficulty) {
  if (!targets.length) return null
  const legal = new Set(targets.map((ball) => ball.n))
  const cue = state.balls[0]
  const cueRef = { x: cue.x, y: cue.y }
  const power = 0.55
  const stepAngle = difficulty === 'hard' ? Math.PI / 90 : Math.PI / 60
  const hits = []
  for (let angle = 0; angle < Math.PI * 2; angle += stepAngle) {
    const shot = { angle, power, spin: { x: 0, y: 0 }, cue: cueRef }
    const hitN = firstContactNumber(state, shot, legal)
    if (hitN === null) continue
    const target = targets.find((ball) => ball.n === hitN)
    if (!target) continue
    hits.push({
      angle,
      power,
      distance: Math.hypot(target.x - cue.x, target.y - cue.y),
    })
  }
  if (!hits.length) return null
  hits.sort((a, b) => a.distance - b.distance)
  // 再跑几杆完整模拟，避免解到球后白球又落袋。
  for (const hit of hits.slice(0, 5)) {
    const trial = structuredClone({ ...state, geo: null, events: [] })
    trial.geo = state.geo
    trial.events = []
    simulateShot(trial, {
      angle: hit.angle,
      power: hit.power,
      spin: { x: 0, y: 0 },
      cue: cueRef,
    })
    if (trial.cueIn || trial.inHand || trial.phase === 'choice') continue
    if (trial.firstHit === null || !legal.has(trial.firstHit)) continue
    return { angle: hit.angle, power: hit.power, target: trial.firstHit }
  }
  return null
}

function legalTargets(state, seat) {
  const onTable = state.balls.filter((ball) => ball.on && ball.n !== 0)
  if (state.mode === 'pool') {
    const eight = onTable.find((ball) => ball.n === 8)
    if (state.breakShot) return onTable.filter((ball) => ball.n !== 8)
    const group = state.grp[seat]
    if (!group) {
      const rest = onTable.filter((ball) => ball.n !== 8)
      return rest.length ? rest : eight ? [eight] : []
    }
    const groupBalls = onTable.filter(
      (ball) => ball.n !== 8 && groupOf(ball.n) === group,
    )
    if (groupBalls.length) return groupBalls
    return eight ? [eight] : []
  }

  if (state.sn.decider) {
    const black = onTable.find((ball) => ball.n === 21)
    return black ? [black] : []
  }
  const freeBall = state.sn.freeBall
    ? onTable.find((ball) => ball.n === state.sn.freeBall)
    : null
  const reds = onTable.filter((ball) => ball.n >= 1 && ball.n <= 15)
  if (freeBall) return [freeBall]
  if (reds.length) {
    if (!state.sn.onRed) return onTable.filter((ball) => ball.n >= 16)
    return reds
  }
  if (state.sn.finalColor) return onTable.filter((ball) => ball.n >= 16)
  const nextColor = onTable.find((ball) => ball.n === 16 + state.sn.idx)
  return nextColor ? [nextColor] : []
}

function potCandidates(state, target) {
  const geo = state.geo
  const { R, PR } = geo
  const cue = state.balls[0]
  const candidates = []
  for (const pocket of PR) {
    const dx = pocket[0] - target.x
    const dy = pocket[1] - target.y
    const pocketDistance = Math.hypot(dx, dy)
    if (pocketDistance < R * 2) continue
    const ux = dx / pocketDistance
    const uy = dy / pocketDistance
    const gx = target.x - ux * 2 * R
    const gy = target.y - uy * 2 * R
    if (gx < R || gx > geo.W - R || gy < R || gy > geo.H - R) continue
    if (PR.some((q) => Math.hypot(gx - q[0], gy - q[1]) < q[2] * 0.85))
      continue
    if ((cue.x - target.x) * ux + (cue.y - target.y) * uy >= 0) continue
    const toPocket = castRay(
      geo,
      state.balls,
      target.x,
      target.y,
      ux,
      uy,
      target.n,
    )
    if (toPocket.ball) continue
    const cueDx = gx - cue.x
    const cueDy = gy - cue.y
    const cueDistance = Math.hypot(cueDx, cueDy)
    if (cueDistance < R * 2) continue
    const cueHit = castRay(
      geo,
      state.balls,
      cue.x,
      cue.y,
      cueDx / cueDistance,
      cueDy / cueDistance,
      0,
    )
    if (cueHit.ball !== target) continue
    // 切角越小越稳：1 表示正对袋口，接近 0 表示薄边。
    const targetDistance = Math.hypot(target.x - cue.x, target.y - cue.y)
    const cutCos =
      Math.min(
        1,
        ((target.x - cue.x) * ux + (target.y - cue.y) * uy) / targetDistance,
      )
    candidates.push({
      target,
      angle: Math.atan2(cueDy, cueDx),
      distance: cueDistance + pocketDistance * 0.8,
      cut: cutCos,
      power: Math.max(
        0.28,
        Math.min(0.9, 0.28 + (cueDistance + pocketDistance * 0.7) / 4500),
      ),
    })
  }
  return candidates
}

export function chooseAiShot(state, seat = 1, difficulty = 'normal') {
  const d = AI_DIFFICULTY[difficulty] || AI_DIFFICULTY.normal
  const geo = state.geo || getGeometry(state.mode)
  const cue = state.balls[0]
  const cueRef = { x: cue.x, y: cue.y }

  if (state.mode === 'pool' && state.breakShot) {
    const rack = state.balls.filter(
      (ball) => ball.on && ball.n !== 0 && ball.n !== 8,
    )
    if (rack.length) {
      const cx =
        rack.reduce((sum, ball) => sum + ball.x, 0) / rack.length
      const cy =
        rack.reduce((sum, ball) => sum + ball.y, 0) / rack.length
      return {
        angle: Math.atan2(cy - cue.y, cx - cue.x),
        power: 1,
        spin: { x: 0, y: 0 },
        cue: cueRef,
      }
    }
  }

  const targets = legalTargets(state, seat)
  const directTargets = state.inHandLine && !state.breakShot
    ? targets.filter((target) => target.x >= geo.W / 4)
    : targets
  const candidates = []
  for (const target of directTargets) {
    for (const candidate of potCandidates(state, target)) {
      candidates.push(candidate)
    }
  }
  let best = null
  for (const candidate of candidates) {
    if (difficulty === 'hard') {
      // 困难：优先选切角小、距离短、成功率最高的球，而不是最近的球。
      const quality =
        Math.max(0.05, candidate.cut) ** 2 / (1 + candidate.distance / 2600)
      if (!best || quality > best.quality) best = { ...candidate, quality }
    } else if (!best || candidate.distance < best.distance) {
      best = candidate
    }
  }
  if (best && d.randomPick > 0 && candidates.length > 1 && Math.random() < d.randomPick) {
    best = candidates[Math.floor(Math.random() * candidates.length)]
  }
  if (best) {
    const angle = best.angle + (Math.random() - 0.5) * d.angle
    const power = Math.max(
      0.25,
      Math.min(0.95, best.power + (Math.random() - 0.5) * d.power),
    )
    const nominatedColor = canNominateColor(state, best.target.n) ? best.target.n : null
    if (difficulty === 'hard') {
      let picked = null
      for (const spin of HARD_SPINS) {
        const result = trialShot(
          state,
          { angle, power, spin, cue: cueRef, nominatedColor },
          best.target.n,
        )
        // 结果相近时更愿意加塞走位，但不会为了炫技牺牲进球。
        const bonus = spin.x !== 0 && result.potted ? 60 : 0
        const score = result.score + bonus
        if (!picked || score > picked.score) picked = { score, spin }
      }
      return { angle, power, spin: picked.spin, cue: cueRef, nominatedColor }
    }
    return { angle, power, spin: { x: 0, y: 0 }, cue: cueRef, nominatedColor }
  }

  let safety = null
  let direct = null
  for (const target of directTargets) {
    const dx = target.x - cue.x
    const dy = target.y - cue.y
    const distance = Math.hypot(dx, dy)
    if (distance < 1) continue
    const hit = castRay(
      geo,
      state.balls,
      cue.x,
      cue.y,
      dx / distance,
      dy / distance,
      0,
    )
    const clear = hit.ball === target
    if (clear && (!direct || distance < direct.distance))
      direct = {
        angle: Math.atan2(dy, dx),
        power: Math.max(0.3, Math.min(0.8, 0.35 + distance / 5000)),
        distance,
        target: target.n,
      }
    const score = distance + (clear ? 0 : 10000)
    if (!safety || score < safety.score)
      safety = {
        angle: Math.atan2(dy, dx),
        power: Math.max(0.3, Math.min(0.8, 0.35 + distance / 5000)),
        score,
        target: target.n,
      }
  }
  if (direct) {
    return {
      angle: direct.angle + (Math.random() - 0.5) * d.safety,
      power: direct.power,
      nominatedColor: canNominateColor(state, direct.target) ? direct.target : null,
      spin: { x: 0, y: 0 },
      cue: cueRef,
    }
  }
  // 没有不借库就能碰到合法球的角度：扫描一圈找解球线路。
  const escape = findEscapeShot(state, targets, difficulty)
  if (escape) {
    const noise =
      (Math.random() - 0.5) * d.safety * (difficulty === 'easy' ? 1 : 0.3)
    const angle = escape.angle + noise
    const legal = new Set(targets.map((ball) => ball.n))
    const stillLegal = firstContactNumber(
      state,
      { angle, power: escape.power, spin: { x: 0, y: 0 }, cue: cueRef },
      legal,
    )
    return {
      angle: stillLegal === null ? escape.angle : angle,
      power: escape.power,
      nominatedColor: canNominateColor(state, stillLegal ?? escape.target) ? stillLegal ?? escape.target : null,
      spin: { x: 0, y: 0 },
      cue: cueRef,
    }
  }
  if (safety) {
    return {
      angle: safety.angle + (Math.random() - 0.5) * d.safety,
      power: safety.power,
      nominatedColor: canNominateColor(state, safety.target) ? safety.target : null,
      spin: { x: 0, y: 0 },
      cue: cueRef,
    }
  }

  return {
    angle: Math.atan2(geo.H / 2 - cue.y, geo.W * 0.75 - cue.x),
    power: 0.85,
    nominatedColor: targets.find((target) => canNominateColor(state, target.n))?.n ?? null,
    spin: { x: 0, y: 0 },
    cue: cueRef,
  }
}

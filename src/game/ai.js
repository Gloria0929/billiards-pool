import { getGeometry } from './geometry.js'
import { castRay } from './physics.js'

const SOLIDS = 'solid'

function groupOf(n) {
  return n < 8 ? SOLIDS : 'stripe'
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

  const reds = onTable.filter((ball) => ball.n >= 1 && ball.n <= 15)
  if (reds.length)
    return state.sn.onRed
      ? reds
      : onTable.filter((ball) => ball.n >= 16)
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
    candidates.push({
      target,
      angle: Math.atan2(cueDy, cueDx),
      distance: cueDistance + pocketDistance * 0.8,
      power: Math.max(
        0.28,
        Math.min(0.9, 0.28 + (cueDistance + pocketDistance * 0.7) / 4500),
      ),
    })
  }
  return candidates
}

export function chooseAiShot(state, seat = 1) {
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
        power: 0.95,
        spin: { x: 0, y: 0 },
        cue: cueRef,
      }
    }
  }

  const targets = legalTargets(state, seat)
  let best = null
  for (const target of targets) {
    for (const candidate of potCandidates(state, target)) {
      if (!best || candidate.distance < best.distance) best = candidate
    }
  }
  if (best) {
    const angle = best.angle + (Math.random() - 0.5) * 0.008
    const power = Math.max(
      0.25,
      Math.min(0.95, best.power + (Math.random() - 0.5) * 0.04),
    )
    return { angle, power, spin: { x: 0, y: 0 }, cue: cueRef }
  }

  let safety = null
  for (const target of targets) {
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
    const score = distance + (clear ? 0 : 10000)
    if (!safety || score < safety.score)
      safety = {
        angle: Math.atan2(dy, dx),
        power: Math.max(0.3, Math.min(0.8, 0.35 + distance / 5000)),
        score,
      }
  }
  if (safety) {
    return {
      angle: safety.angle + (Math.random() - 0.5) * 0.02,
      power: safety.power,
      spin: { x: 0, y: 0 },
      cue: cueRef,
    }
  }

  return {
    angle: Math.atan2(geo.H / 2 - cue.y, geo.W * 0.75 - cue.x),
    power: 0.85,
    spin: { x: 0, y: 0 },
    cue: cueRef,
  }
}

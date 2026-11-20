import { DT, G, MUS, MUR, RAIL } from './constants.js'
import { canPlace, cueSpot } from './geometry.js'

const pushEvent = (state, kind, speed, x, y, id) => {
  if (state.events.length < 3000)
    state.events.push({ k: kind, s: speed, x, y, id })
}

export function free(geo, balls, x, y, ex) {
  const { W, H, R, PR } = geo
  if (x < R || x > W - R || y < R || y > H - R) return false
  if (PR.some((q) => Math.hypot(x - q[0], y - q[1]) < q[2] * 0.85 + R * 0.2))
    return false
  return balls.every(
    (b) => b === ex || !b.on || Math.hypot(b.x - x, b.y - y) >= 2 * R + 0.5,
  )
}

export function canPlaceCue(state, x, y) {
  const { geo, balls } = state
  return Number.isFinite(x) && Number.isFinite(y) &&
    canPlace(geo, state, x, y) && free(geo, balls, x, y, balls[0])
}

export function placeCue(state) {
  const { geo, balls } = state
  place(geo, balls, balls[0], ...cueSpot(geo), (x, y) => canPlace(geo, state, x, y))
}

export function place(geo, balls, b, x, y, allowed = () => true) {
  for (let k = 0; k < 500; k++) {
    const a = k * 2.4
    const r = k * 4
    const X = x + r * Math.cos(a)
    const Y = y + r * Math.sin(a)
    if (allowed(X, Y) && free(geo, balls, X, Y, b)) {
      b.x = X
      b.y = Y
      break
    }
  }
  b.on = true
  b.vx = b.vy = b.wx = b.wy = b.wz = 0
  b.st = 0
  b.q = null
  b.fallSpin = null
}

function edgeDistance(b, a, c) {
  const dx = c[0] - a[0]
  const dy = c[1] - a[1]
  const t = Math.max(0, Math.min(1,
    ((b.x - a[0]) * dx + (b.y - a[1]) * dy) / (dx * dx + dy * dy),
  ))
  return [b.x - a[0] - dx * t, b.y - a[1] - dy * t]
}

export function frozenCushions(geo, balls) {
  return Object.fromEntries(balls.filter((ball) => ball.on).map((ball) => [
    ball.n,
    geo.cushionEdges.flatMap(([a, c], i) =>
      Math.hypot(...edgeDistance(ball, a, c)) <= geo.R + 0.05 ? [i] : [],
    ),
  ]))
}

export function bounce(state, b, nx, ny, counts = true) {
  const { R } = state.geo
  const vn = b.vx * nx + b.vy * ny
  if (vn >= 0) return
  const e = Math.max(0.55, 0.86 - 0.00007 * -vn)
  const J = (1 + e) * -vn
  b.vx += J * nx
  b.vy += J * ny
  const q = -ny
  const r = nx
  const s = 0.27
  const c = Math.sqrt(1 - s * s)
  const ut =
    b.vx * q + b.vy * r - R * (s * (b.wx * nx + b.wy * ny) + c * b.wz)
  // The cushion has two slip directions. Omitting the vertical one leaves all
  // incoming topspin intact, which then brakes the rebounding ball on the cloth.
  // Use one Coulomb-friction budget for both directions at the raised contact.
  // Slip directions: Mathavan et al. (2010), section 2.3.
  const uv = s * (b.vx * nx + b.vy * ny) + R * (-b.wx * ny + b.wy * nx)
  const sideImpulse = -ut / 3.5
  const verticalImpulse = -uv / (2.5 + s * s)
  const impulse = Math.hypot(sideImpulse, verticalImpulse)
  const scale = impulse > 0 ? Math.min(1, 0.2 * J / impulse) : 0
  const sideFriction = sideImpulse * scale
  const verticalFriction = verticalImpulse * scale
  const k = 2.5 / R
  b.vx += sideFriction * q + verticalFriction * s * nx
  b.vy += sideFriction * r + verticalFriction * s * ny
  b.wx -= k * (sideFriction * s * nx + verticalFriction * ny)
  b.wy += k * (-sideFriction * s * ny + verticalFriction * nx)
  b.wz -= k * sideFriction * c
  pushEvent(state, 'r', -vn, b.x, b.y, b.n)
  // 规则判定用的碰库记录：events 每帧会被音效消费清空，这里单独保留。
  if (counts && state.firstHit !== null) state.railAfterContact = true
  if (b.n >= 1 && Array.isArray(state.railBalls) && !state.railBalls.includes(b.n))
    state.railBalls.push(b.n)
}

function wall(state, b) {
  // Resolve against the same six cushion polygons used by the renderer.
  const { R, cushionEdges } = state.geo
  const frozen = state.frozenRails?.[b.n]
  if (frozen?.length) {
    state.frozenRails[b.n] = frozen.filter((i) =>
      Math.hypot(...edgeDistance(b, ...cushionEdges[i])) <= R + 0.05)
  }
  for (let i = 0; i < cushionEdges.length; i++) {
    const [a, c] = cushionEdges[i]
    if (
      b.x < Math.min(a[0], c[0]) - R ||
      b.x > Math.max(a[0], c[0]) + R ||
      b.y < Math.min(a[1], c[1]) - R ||
      b.y > Math.max(a[1], c[1]) + R
    )
      continue
    const [px, py] = edgeDistance(b, a, c)
    const d = Math.hypot(px, py)
    if (d < R && d > 1e-6) {
      const nx = px / d
      const ny = py / d
      b.x += nx * (R + 0.001 - d)
      b.y += ny * (R + 0.001 - d)
      bounce(state, b, nx, ny, !state.frozenRails?.[b.n]?.includes(i))
    }
  }
}

function cap(state, b, q) {
  b.on = false
  b.st = 0
  b.q = q
  const s = Math.hypot(b.vx, b.vy)
  b.fallSpin = { x: b.vx, y: b.vy, speed: Math.max(100, s * 0.35) }
  b.vx = b.vy = b.wx = b.wy = b.wz = 0
  if (b.n === 0) state.cueIn = true
  else state.potted.push(b.n)
  pushEvent(state, 'p', s, b.x, b.y, b.n)
}

export function step(state) {
  const geo = state.geo
  const { R, W, H, PR } = geo
  const balls = state.balls
  for (const b of balls) {
    if (!b.on) continue
    if (!(b.vx || b.vy || b.wx || b.wy || b.wz)) continue
    b.x += b.vx * DT
    b.y += b.vy * DT
    const ux = b.vx - R * b.wy
    const uy = b.vy + R * b.wx
    const um = Math.hypot(ux, uy)
    const mu = b.mu || 1
    if (um > 8) {
      const a = MUS * G * DT * mu
      const ax = ux / um
      const ay = uy / um
      b.vx -= a * ax
      b.vy -= a * ay
      const al = ((2.5 * MUS * G) / R) * DT * mu
      b.wx -= al * ay
      b.wy += al * ax
    } else {
      const s = Math.hypot(b.vx, b.vy)
      if (s < 6) {
        b.vx = b.vy = b.wx = b.wy = 0
      } else {
        const f = Math.max(0, s - MUR * G * DT * mu) / s
        b.vx *= f
        b.vy *= f
        b.wx = -b.vy / R
        b.wy = b.vx / R
      }
    }
    b.wz = Math.abs(b.wz) < 1e-4 ? 0 : b.wz * (1 - DT * 1.5)
    wall(state, b)
  }
  if (state.mode === 'pool') {
    const line = W / 4
    if (state.breakShot && state.breakCrossed) {
      for (const b of balls)
        if (b.n && b.on && b.x <= line && !state.breakCrossed.includes(b.n))
          state.breakCrossed.push(b.n)
    }
    if (state.shotStart?.inHandLine && state.firstHit === null && balls[0].x >= line)
      state.cueCrossedLine = true
  }
  const recordFirstContact = state.firstHit === null
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]
    if (!a.on) continue
    for (let j = i + 1; j < balls.length; j++) {
      const c = balls[j]
      if (!c.on) continue
      const dx = c.x - a.x
      const dy = c.y - a.y
      const d2 = dx * dx + dy * dy
      if (d2 >= 4 * R * R || d2 === 0) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      const ov = (2 * R - d) / 2
      a.x -= nx * ov
      a.y -= ny * ov
      c.x += nx * ov
      c.y += ny * ov
      const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny
      if (vn > 0) {
        // 每颗球的微小质量差异（摆球时按 seed 生成）让碰撞链更不可预测。
        const ma = a.m || 1
        const mc = c.m || 1
        const j2 = (1.98 * vn) / (1 / ma + 1 / mc)
        a.vx -= (j2 / ma) * nx
        a.vy -= (j2 / ma) * ny
        c.vx += (j2 / mc) * nx
        c.vy += (j2 / mc) * ny
        pushEvent(state, 'b', vn, (a.x + c.x) / 2, (a.y + c.y) / 2, `${a.n}-${c.n}`)
        {
          // 只有侧旋（加塞，绕竖直轴的 wz）才会让目标球“带偏”。不带塞时
          // 目标球严格沿两球连心线出球，辅助线的预测与实际落点一致。
          const W2 = R * (a.wz + c.wz)
          if (Math.abs(W2) > 1e-6) {
            const P = Math.min(0.06 * j2, Math.abs(W2) / 7)
            const Ph = -P * Math.sign(W2)
            const k = 2.5 / R
            a.vx += -Ph * ny
            a.vy += Ph * nx
            c.vx -= -Ph * ny
            c.vy -= Ph * nx
            for (const o of [a, c]) o.wz += k * Ph
          }
        }
        if (recordFirstContact && (a.n === 0 || c.n === 0)) {
          const object = a.n === 0 ? c : a
          if (state.firstHit === null) state.firstHit = object.n
          state.firstHits?.push(object.n)
        }
      }
    }
  }
  for (const b of balls) {
    if (!b.on || !(b.vx || b.vy)) continue
    for (const q of PR) {
      // 捕获半径与渲染的袋口一致（0.85 倍袋口半径）：球心已经进入袋口
      // 范围就判落袋，避免看起来进袋了却被库边弹回。
      if (Math.hypot(b.x - q[0], b.y - q[1]) < q[2] * 0.85) {
        cap(state, b, q)
        break
      }
    }
    if (b.on && (b.x < -RAIL + R || b.x > W + RAIL - R ||
                 b.y < -RAIL + R || b.y > H + RAIL - R)) {
      b.on = false
      b.vx = b.vy = b.wx = b.wy = b.wz = 0
      b.st = 0
      state.offTable?.push(b.n)
    }
  }
}

export function moving(balls) {
  return balls.some((b) => b.on && (b.vx || b.vy || b.wx || b.wy))
}

export function castRay(geo, balls, sx, sy, dx, dy, ignoreN = null) {
  const { W, H, R } = geo
  let t = 1e9
  let ball = null
  for (const b of balls) {
    if (!b.on || b.n === ignoreN) continue
    const fx = b.x - sx
    const fy = b.y - sy
    const p = fx * dx + fy * dy
    if (p <= 0) continue
    const d2 = fx * fx + fy * fy - p * p
    if (d2 > 4 * R * R) continue
    const tt = p - Math.sqrt(4 * R * R - d2)
    if (tt >= 0 && tt < t) {
      t = tt
      ball = b
    }
  }
  let tw = 1e9
  let wall = null
  if (dx > 1e-9) {
    const d = (W - R - sx) / dx
    if (d < tw) {
      tw = d
      wall = 'right'
    }
  }
  if (dx < -1e-9) {
    const d = (R - sx) / dx
    if (d < tw) {
      tw = d
      wall = 'left'
    }
  }
  if (dy > 1e-9) {
    const d = (H - R - sy) / dy
    if (d < tw) {
      tw = d
      wall = 'bottom'
    }
  }
  if (dy < -1e-9) {
    const d = (R - sy) / dy
    if (d < tw) {
      tw = d
      wall = 'top'
    }
  }
  tw = Math.max(0, tw)
  if (ball && t < tw)
    return { t, x: sx + dx * t, y: sy + dy * t, ball, wall: null }
  return { t: tw, x: sx + dx * tw, y: sy + dy * tw, ball: null, wall }
}

export function aimRay(geo, balls, angle) {
  const cue = balls[0]
  const hit = castRay(
    geo,
    balls,
    cue.x,
    cue.y,
    Math.cos(angle),
    Math.sin(angle),
    0,
  )
  return { t: hit.t, hit: hit.ball, wall: hit.wall, x: hit.x, y: hit.y }
}

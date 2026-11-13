import { DT, G, MUS, MUR, RAIL } from './constants.js'

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

export function place(geo, balls, b, x, y) {
  for (let k = 0; k < 500; k++) {
    const a = k * 2.4
    const r = k * 4
    const X = x + r * Math.cos(a)
    const Y = y + r * Math.sin(a)
    if (free(geo, balls, X, Y, b)) {
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

export function bounce(state, b, nx, ny) {
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
  const c = 0.963
  const ut =
    b.vx * q + b.vy * r - R * (s * (b.wx * nx + b.wy * ny) + c * b.wz)
  const P = Math.min(0.2 * J, Math.abs(ut) / 3.5) * (ut > 0 ? -1 : 1)
  const k = (2.5 / R) * P
  b.vx += P * q
  b.vy += P * r
  b.wx -= k * s * nx
  b.wy -= k * s * ny
  b.wz -= k * c
  pushEvent(state, 'r', -vn, b.x, b.y, b.n)
}

function wall(state, b) {
  // Resolve against the same six cushion polygons used by the renderer.
  for (const [a, c] of state.geo.cushionEdges) {
    const { R } = state.geo
    if (
      b.x < Math.min(a[0], c[0]) - R ||
      b.x > Math.max(a[0], c[0]) + R ||
      b.y < Math.min(a[1], c[1]) - R ||
      b.y > Math.max(a[1], c[1]) + R
    )
      continue
    const dx = c[0] - a[0]
    const dy = c[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = Math.max(
      0,
      Math.min(1, ((b.x - a[0]) * dx + (b.y - a[1]) * dy) / l2),
    )
    const x = a[0] + dx * t
    const y = a[1] + dy * t
    const px = b.x - x
    const py = b.y - y
    const d = Math.hypot(px, py)
    if (d < R && d > 1e-6) {
      const nx = px / d
      const ny = py / d
      b.x = x + nx * (R + 0.001)
      b.y = y + ny * (R + 0.001)
      bounce(state, b, nx, ny)
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
    b.x += b.vx * DT
    b.y += b.vy * DT
    const ux = b.vx - R * b.wy
    const uy = b.vy + R * b.wx
    const um = Math.hypot(ux, uy)
    if (um > 8) {
      const a = MUS * G * DT
      const ax = ux / um
      const ay = uy / um
      b.vx -= a * ax
      b.vy -= a * ay
      const al = ((2.5 * MUS * G) / R) * DT
      b.wx -= al * ay
      b.wy += al * ax
    } else {
      const s = Math.hypot(b.vx, b.vy)
      if (s < 6) {
        b.vx = b.vy = b.wx = b.wy = 0
      } else {
        const f = Math.max(0, s - MUR * G * DT) / s
        b.vx *= f
        b.vy *= f
        b.wx = -b.vy / R
        b.wy = b.vx / R
      }
    }
    b.wz *= 1 - DT * 1.5
    wall(state, b)
  }
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
        const j2 = (1.95 * vn) / 2
        a.vx -= j2 * nx
        a.vy -= j2 * ny
        c.vx += j2 * nx
        c.vy += j2 * ny
        pushEvent(state, 'b', vn, (a.x + c.x) / 2, (a.y + c.y) / 2, `${a.n}-${c.n}`)
        {
          const W2 = R * (a.wz + c.wz)
          const ux = a.vx - c.vx - W2 * ny
          const uy = a.vy - c.vy + W2 * nx
          const uz = R * ((a.wx + c.wx) * ny - (a.wy + c.wy) * nx)
          const uh = -ux * ny + uy * nx
          const m = Math.hypot(uh, uz)
          if (m > 1e-6) {
            const P = Math.min(0.06 * j2, m / 7)
            const Ph = (-P * uh) / m
            const Pz = (-P * uz) / m
            const k = 2.5 / R
            a.vx += -Ph * ny
            a.vy += Ph * nx
            c.vx -= -Ph * ny
            c.vy -= Ph * nx
            for (const o of [a, c]) {
              o.wx += k * ny * Pz
              o.wy -= k * nx * Pz
              o.wz += k * Ph
            }
          }
        }
        if (state.firstHit === null) {
          if (a.n === 0) state.firstHit = c.n
          else if (c.n === 0) state.firstHit = a.n
        }
      }
    }
  }
  for (const b of balls) {
    if (!b.on) continue
    for (const q of PR) {
      if (Math.hypot(b.x - q[0], b.y - q[1]) < q[2] * 0.85 - R * 0.28) {
        cap(state, b, q)
        break
      }
    }
    if (b.on) {
      if (b.x < -RAIL + R) {
        b.x = -RAIL + R
        bounce(state, b, 1, 0)
      }
      if (b.x > W + RAIL - R) {
        b.x = W + RAIL - R
        bounce(state, b, -1, 0)
      }
      if (b.y < -RAIL + R) {
        b.y = -RAIL + R
        bounce(state, b, 0, 1)
      }
      if (b.y > H + RAIL - R) {
        b.y = H + RAIL - R
        bounce(state, b, 0, -1)
      }
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

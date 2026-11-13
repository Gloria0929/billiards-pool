import { castRay } from './physics.js'

function reflected(wall, dx, dy) {
  if (wall === null) return null
  return wall === 'left' || wall === 'right'
    ? { x: -dx, y: dy }
    : { x: dx, y: -dy }
}

function findPocketOnRay(geo, x, y, dx, dy, wallDistance) {
  const { R } = geo
  let best = null
  geo.PR.forEach((q, index) => {
    const px = q[0] - x
    const py = q[1] - y
    const projection = px * dx + py * dy
    if (projection <= q[2] * 0.85) return
    const perpendicular = Math.abs(px * dy - py * dx)
    if (perpendicular > q[2] * 0.85) return
    if (projection > wallDistance + q[2] * 0.85 + R * 2.5) return
    const distance = Math.hypot(px, py)
    if (!best || distance < best.distance)
      best = { index, x: q[0], y: q[1], r: q[2], distance }
  })
  return best
}

function bankFromWall(geo, balls, hit, dx, dy, ignoreN) {
  if (!hit.wall) return null
  const direction = reflected(hit.wall, dx, dy)
  const startX = hit.x + direction.x * 0.5
  const startY = hit.y + direction.y * 0.5
  const next = castRay(
    geo,
    balls,
    startX,
    startY,
    direction.x,
    direction.y,
    ignoreN,
  )
  const from = { x: hit.x, y: hit.y }
  if (next.ball)
    return { from, to: { x: next.x, y: next.y }, pocket: null }
  const pocket = findPocketOnRay(
    geo,
    hit.x,
    hit.y,
    direction.x,
    direction.y,
    next.t,
  )
  if (pocket) return { from, to: { x: pocket.x, y: pocket.y }, pocket }
  return { from, to: { x: next.x, y: next.y }, pocket: null }
}

export function buildAimGuide(geo, balls, angle) {
  const { R } = geo
  const cue = balls[0]
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const aim = castRay(geo, balls, cue.x, cue.y, dx, dy, 0)
  const guide = {
    cue: { x: cue.x, y: cue.y },
    ghost: { x: aim.x, y: aim.y },
    hitBall: aim.ball,
    hitWall: aim.wall,
    cueBank: null,
    object: null,
    objectBank: null,
    deflect: null,
    normal: null,
  }
  if (aim.ball) {
    const target = aim.ball
    const nx = (target.x - aim.x) / (2 * R)
    const ny = (target.y - aim.y) / (2 * R)
    const dot = dx * nx + dy * ny
    guide.normal = { x: nx, y: ny }
    guide.deflect = { x: dx - dot * nx, y: dy - dot * ny }
    const objectPath = castRay(
      geo,
      balls,
      target.x,
      target.y,
      nx,
      ny,
      target.n,
    )
    guide.object = {
      from: { x: target.x, y: target.y },
      to: { x: objectPath.x, y: objectPath.y },
      hitBall: objectPath.ball,
    }
    if (!objectPath.ball)
      guide.objectBank = bankFromWall(
        geo,
        balls,
        objectPath,
        nx,
        ny,
        target.n,
      )
  } else {
    guide.cueBank = bankFromWall(geo, balls, aim, dx, dy, 0)
  }
  return guide
}

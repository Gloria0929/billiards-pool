import { BX, DR, MODES } from './constants.js'

const geometryCache = new Map()

function cushionEdgesFor({ W, H, gC, gS, py, PR }) {
  const t = 50
  const edges = []
  const cu = (points) => {
    for (let i = 0; i < points.length; i++)
      edges.push([points[i], points[(i + 1) % points.length]])
  }
  const fc = Math.max(
    0,
    Math.min(t, gC - Math.sqrt(Math.max(0, (PR[0][2] * 0.85 + 3) ** 2 - t * t))),
  )
  const fd = Math.max(
    0,
    Math.min(
      t,
      gS -
        Math.sqrt(
          Math.max(0, (PR[1][2] * 0.85 + 3) ** 2 - (t - py) ** 2),
        ),
    ),
  )
  const hw = W / 2
  const hr = (u0, u1, y0, sg, a, b) =>
    cu([
      [u0, y0],
      [u1, y0],
      [u1 + b, y0 + sg * t],
      [u0 - a, y0 + sg * t],
    ])
  const vr = (v0, v1, x0, sg, a, b) =>
    cu([
      [x0, v0],
      [x0, v1],
      [x0 + sg * t, v1 + b],
      [x0 + sg * t, v0 - a],
    ])
  hr(gC, hw - gS, 0, -1, fc, fd)
  hr(hw + gS, W - gC, 0, -1, fd, fc)
  hr(gC, hw - gS, H, 1, fc, fd)
  hr(hw + gS, W - gC, H, 1, fd, fc)
  vr(gC, H - gC, 0, -1, fc, fc)
  vr(gC, H - gC, W, 1, fc, fc)
  return edges
}

export function getGeometry(mode = 'pool') {
  if (geometryCache.has(mode)) return geometryCache.get(mode)
  const c = MODES[mode] || MODES.pool
  const { W, H, R, gC, gS } = c
  const PR = [
    [0, 0, c.pc],
    [W / 2, -c.py, c.ps],
    [W, 0, c.pc],
    [0, H, c.pc],
    [W / 2, H + c.py, c.ps],
    [W, H, c.pc],
  ]
  const geo = {
    mode,
    W,
    H,
    R,
    gC,
    gS,
    py: c.py,
    PR,
    cushionEdges: cushionEdgesFor({ W, H, gC, gS, py: c.py, PR }),
  }
  geometryCache.set(mode, geo)
  return geo
}

export const toWorldX = (geo, x) => x - geo.W / 2
export const toWorldZ = (geo, y) => geo.H / 2 - y

export function cueSpot(geo) {
  return geo.mode === 'snk' ? [BX - 120, geo.H / 2] : [geo.W * 0.25, geo.H / 2]
}

export function colorSpot(geo, n) {
  const { W, H } = geo
  return [
    [BX, H / 2 + DR],
    [BX, H / 2 - DR],
    [BX, H / 2],
    [W / 2, H / 2],
    [W * 0.75, H / 2],
    [W - 324, H / 2],
  ][n - 16]
}

export function canPlace(geo, state, x, y) {
  return geo.mode === 'snk'
    ? x <= BX && Math.hypot(x - BX, y - geo.H / 2) <= DR
    : state.breakShot
      ? x <= geo.W / 4
      : true
}

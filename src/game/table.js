import * as THREE from 'three'
import { BX, DR } from './constants.js'
import { CUSHION_DEPTH, toWorldX, toWorldZ } from './geometry.js'
import { surfaceColor } from './table-materials.js'

const CUSHION_TOP = 53
const RAIL_TOP = 61
const CLOTH_OVERHANG = 37
const POCKET_ROLLOFF = 9
export const TABLE_FLOOR = -789

export function tableMargins(geo) {
  // Q8 的外框按 2820 × 1540 mm 建模，台内坐标供现有碰撞模拟使用。
  return geo.mode === 'snk' ? [133, 133] : [140, 135]
}

function mesh(group, geometry, material, x = 0, y = 0, z = 0) {
  const part = new THREE.Mesh(geometry, material)
  part.position.set(x, y, z)
  group.add(part)
  return part
}

function texture(width, height, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas.getContext('2d'), width, height)
  return new THREE.CanvasTexture(canvas)
}

function roundedFrame(x, y, r) {
  const path = new THREE.Shape()
  path.moveTo(-x + r, -y)
  path.lineTo(x - r, -y)
  path.quadraticCurveTo(x, -y, x, -y + r)
  path.lineTo(x, y - r)
  path.quadraticCurveTo(x, y, x - r, y)
  path.lineTo(-x + r, y)
  path.quadraticCurveTo(-x, y, -x, y - r)
  path.lineTo(-x, -y + r)
  path.quadraticCurveTo(-x, -y, -x + r, -y)
  return path
}

function pocketOutline(geo, depth, clothSurface) {
  const { W, H, PR, py } = geo
  const hw = W / 2
  const hh = H / 2
  const allowance = clothSurface ? 0 : 6
  const corner = PR[0][2] * 0.85 + allowance
  const side = PR[1][2] * 0.85 + allowance
  const c = Math.sqrt(corner ** 2 - depth ** 2)
  const s = Math.sqrt(side ** 2 - (depth - py) ** 2)
  const path = new THREE.Shape()
  const lips = []
  const arc = (x, y, radius, start, end) => {
    const first = Math.atan2(start[1] - y, start[0] - x)
    const last = Math.atan2(end[1] - y, end[0] - x)
    path.absarc(x, y, radius, first, last, clothSurface)
    if (clothSurface) lips.push(path.curves[path.curves.length - 1])
  }
  const a = [-hw + c, -hh - depth]
  const b = [hw - c, -hh - depth]
  const d = [hw + depth, -hh + c]
  const e = [hw + depth, hh - c]
  const f = [hw - c, hh + depth]
  const g = [-hw + c, hh + depth]
  const h = [-hw - depth, hh - c]
  const j = [-hw - depth, -hh + c]
  path.moveTo(...a)
  path.lineTo(-s, -hh - depth)
  arc(0, -hh - py, side, [-s, -hh - depth], [s, -hh - depth])
  path.lineTo(...b)
  arc(hw, -hh, corner, b, d)
  path.lineTo(...e)
  arc(hw, hh, corner, e, f)
  path.lineTo(s, hh + depth)
  arc(0, hh + py, side, [s, hh + depth], [-s, hh + depth])
  path.lineTo(...g)
  arc(-hw, hh, corner, g, h)
  path.lineTo(...j)
  arc(-hw, -hh, corner, j, a)
  path.closePath()
  return { path, lips }
}

function extrude(group, shape, material, y, depth, bevel) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 20,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelThickness: bevel,
    bevelSize: bevel,
  })
  geometry.rotateX(-Math.PI / 2)
  return mesh(group, geometry, material, 0, y)
}

function makeBed(table, geo, cloth, foldedCloth) {
  const { path, lips } = pocketOutline(geo, CLOTH_OVERHANG, true)
  const geometry = new THREE.ShapeGeometry(path, 32)
  geometry.rotateX(-Math.PI / 2)
  mesh(table, geometry, cloth).name = 'playing-cloth'

  // Approximate the quarter-round slate edge with the cloth wrapped over it.
  const profile = [[0, 0], [-2.6, -0.55], [-4.6, -2.15], [-5.65, -4.75], [-5.8, -POCKET_ROLLOFF]]
  const segments = 64
  for (const arc of lips) {
    const positions = []
    const uv = []
    const indices = []
    const centre = new THREE.Vector2(arc.aX, arc.aY)
    const length = arc.getLength()
    for (const [offset, height] of profile) {
      for (let i = 0; i <= segments; i++) {
        const point = arc.getPoint(i / segments)
        const radial = point.clone().sub(centre).normalize()
        point.addScaledVector(radial, offset)
        positions.push(point.x, height, -point.y)
        uv.push(length * i / segments, offset - height)
      }
    }
    for (let row = 0; row < profile.length - 1; row++) {
      for (let i = 0; i < segments; i++) {
        const here = row * (segments + 1) + i
        const lower = here + segments + 1
        indices.push(here, here + 1, lower, here + 1, lower + 1, lower)
      }
    }
    const edge = new THREE.BufferGeometry()
    edge.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    edge.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    edge.setIndex(indices)
    edge.computeVertexNormals()
    mesh(table, edge, foldedCloth).name = 'pocket-cloth-fold'
  }
}

function makeCushion(geo, outline) {
  const [a, b, c] = outline
  const outward = new THREE.Vector2(c[0] - b[0], c[1] - b[1])
  if (a[0] === b[0]) outward.y = 0
  else outward.x = 0
  outward.normalize()
  const profile = [[0, 17], [8, 13], [23, 5], [32, 0.65], [35, 0], [38, 0.8],
    [42, 4], [49, 15], [CUSHION_TOP, 30]]
  const cornerSteps = 4
  const ringSize = outline.length * (cornerSteps + 1)
  const positions = []
  const uv = []
  for (const [height, inset] of profile) {
    const ring = outline.map(([x, y], i) => {
      const offset = i < 2 ? inset : 1
      return new THREE.Vector2(x + outward.x * offset, y + outward.y * offset)
    })
    for (let i = 0; i < ring.length; i++) {
      const corner = ring[i]
      const prev = ring[(i + ring.length - 1) % ring.length]
      const next = ring[(i + 1) % ring.length]
      const radius = i < 2 ? 8 : 3
      const from = corner.clone().lerp(prev, Math.min(0.4, radius / corner.distanceTo(prev)))
      const to = corner.clone().lerp(next, Math.min(0.4, radius / corner.distanceTo(next)))
      const curve = new THREE.QuadraticBezierCurve(from, corner, to)
      for (let j = 0; j <= cornerSteps; j++) {
        const { x, y } = curve.getPoint(j / cornerSteps)
        positions.push(toWorldX(geo, x), height, toWorldZ(geo, y))
        if (outward.x) uv.push(y, height + outward.x * x)
        else uv.push(x, height + outward.y * y)
      }
    }
  }
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const clockwise = dx * outward.y - dy * outward.x > 0
  const indices = []
  function face(i, j, k) {
    indices.push(i, clockwise ? k : j, clockwise ? j : k)
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < ringSize; i++) {
      const first = j * ringSize + i
      const next = j * ringSize + (i + 1) % ringSize
      face(first, first + ringSize, next)
      face(next, first + ringSize, next + ringSize)
    }
  }
  const top = (profile.length - 1) * ringSize
  for (let i = ringSize - 1; i >= 2; i--) face(top, top + i, top + i - 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function makeCords(table, strands, radius, material) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 5)
  const cords = new THREE.InstancedMesh(geometry, material, strands.length / 6)
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 1, 0)
  const transform = new THREE.Object3D()
  for (let i = 0; i < strands.length; i += 6) {
    start.fromArray(strands, i)
    end.fromArray(strands, i + 3).sub(start)
    transform.position.copy(start).addScaledVector(end, 0.5)
    transform.scale.y = end.length()
    transform.quaternion.setFromUnitVectors(axis, end.normalize())
    transform.updateMatrix()
    cords.setMatrixAt(i / 6, transform.matrix)
  }
  // r128 uses the cylinder's bound for culling rather than the entire bag.
  cords.frustumCulled = false
  table.add(cords)
}

function makePocket(table, geo, pocket, outer, materials, q8) {
  const [px, py, size] = pocket
  const x = toWorldX(geo, px)
  const z = toWorldZ(geo, py)
  const radius = size * 0.85
  const corner = px === 0 || px === geo.W
  const direction = Math.atan2(-z, x * 0.52)
  const exteriorSweep = corner ? 0.47 : 0.52
  const mouthSweep = corner ? 0.96 : 1.12
  const collar = new THREE.Shape()
  function point(fraction, outside) {
    const angle = direction + fraction * (outside ? exteriorSweep : mouthSweep)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    if (!outside) return [x + (radius + 6) * dx, -z + (radius + 6) * dy]
    const xExit = Math.abs(dx) > 1e-6
      ? ((outer[0] - 1) * Math.sign(dx) - x) / dx : Infinity
    const yExit = Math.abs(dy) > 1e-6
      ? ((outer[1] - 1) * Math.sign(dy) + z) / dy : Infinity
    let r = Math.min(xExit, yExit)
    if (corner) {
      // Round the pocket cap around the outside corner of the cabinet.
      const radius = 43
      const cx = (outer[0] - radius - 1) * Math.sign(x)
      const cy = (outer[1] - radius - 1) * Math.sign(-z)
      if ((x + r * dx - cx) * Math.sign(x) > 0 && (-z + r * dy - cy) * Math.sign(-z) > 0) {
        const offsetX = x - cx
        const offsetY = -z - cy
        const along = offsetX * dx + offsetY * dy
        r = -along + Math.sqrt(along ** 2 + radius ** 2 - offsetX ** 2 - offsetY ** 2)
      }
    }
    return [x + r * dx, -z + r * dy]
  }
  collar.moveTo(...point(-1, false))
  for (let i = 1; i <= 32; i++) collar.lineTo(...point(i / 16 - 1, false))
  for (let i = 32; i >= 0; i--) collar.lineTo(...point(i / 16 - 1, true))
  collar.closePath()
  const cap = extrude(table, collar, materials.leather, -58, 112, 8)
  const capPositions = cap.geometry.getAttribute('position')
  const colours = []
  for (let i = 0; i < capPositions.count; i++) {
    const distance = Math.hypot(capPositions.getX(i) - x, capPositions.getZ(i) - z)
    const innerWall = 1 - THREE.MathUtils.smoothstep(distance, radius + 6, radius + 28)
    const belowRim = 1 - THREE.MathUtils.smoothstep(capPositions.getY(i) - 58, 11, RAIL_TOP - 2)
    const shade = 1 - innerWall * belowRim * 0.68
    colours.push(shade, shade, shade)
  }
  cap.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))

  if (q8) {
    const stitches = []
    function stitchPoint(i) {
      const fraction = i / 24 - 1
      const angle = direction + exteriorSweep * fraction
      const [sx, sy] = point(fraction, true)
      return [sx + Math.cos(angle) * 3.8, 30, -sy - Math.sin(angle) * 3.8]
    }
    for (let i = 1; i < 47; i += 2)
      stitches.push(...stitchPoint(i), ...stitchPoint(i + 0.95))
    makeCords(table, stitches, 0.75, materials.thread)
  }

  const liner = new THREE.LatheGeometry([
    new THREE.Vector2(radius * 0.72, -88),
    new THREE.Vector2(radius - 9, -40),
    new THREE.Vector2(radius - 5.75, -POCKET_ROLLOFF + 0.15),
  ], 42)
  mesh(table, liner, materials.liner, x, 0, z).name = 'pocket-liner'

  const bottom = mesh(table, new THREE.CircleGeometry(radius * 0.86, 38), materials.pocketDark, x, -58, z)
  bottom.rotation.x = -Math.PI / 2

  const outwardX = Math.cos(direction)
  const outwardZ = -Math.sin(direction)
  const network = []
  const rings = [
    [-62, 0.9], [-88, 0.78], [-114, 0.71], [-140, 0.64], [-163, 0.57], [-185, 0.54],
  ]
  const cords = q8 ? 27 : 22
  for (let row = 0; row < rings.length - 1; row++) {
    const [height, width] = rings[row]
    const [nextHeight, nextWidth] = rings[row + 1]
    const shift = q8 ? 28 + (-height - 62) * 0.43 : 20
    const nextShift = q8 ? 28 + (-nextHeight - 62) * 0.43 : 20
    for (let i = 0; i < cords; i++) {
      const theta = Math.PI * 2 * (i + (row % 2) / 2) / cords
      for (const side of [-1, 1]) {
        const next = theta + side * Math.PI / cords
        network.push(
          x + outwardX * shift + Math.cos(theta) * radius * width,
          height,
          z + outwardZ * shift + Math.sin(theta) * radius * width,
          x + outwardX * nextShift + Math.cos(next) * radius * nextWidth,
          nextHeight,
          z + outwardZ * nextShift + Math.sin(next) * radius * nextWidth,
        )
      }
    }
  }
  makeCords(table, network, 0.78, materials.net)
  const hoopOffset = q8 ? 81 : 20
  const hoopX = x + outwardX * hoopOffset
  const hoopZ = z + outwardZ * hoopOffset
  const hoop = mesh(table, new THREE.TorusGeometry(radius * 0.56, 2.7, 8, 40),
    materials.metal, hoopX, -185, hoopZ)
  hoop.rotation.x = -Math.PI / 2
  if (!q8) return

  const railDirection = new THREE.Vector2(-outwardZ, outwardX)
  if (railDirection.x * x > 0) railDirection.negate()
  for (const side of [-1, 1]) {
    const fromX = hoopX + outwardX * side * 19
    const fromZ = hoopZ + outwardZ * side * 19
    const bend = new THREE.CatmullRomCurve3([
      new THREE.Vector3(fromX, -182, fromZ),
      new THREE.Vector3(fromX + railDirection.x * 33, -209, fromZ + railDirection.y * 33),
      new THREE.Vector3(fromX + railDirection.x * 128, -219, fromZ + railDirection.y * 128),
      new THREE.Vector3(fromX + railDirection.x * 163 - outwardX * 18, -152,
        fromZ + railDirection.y * 163 - outwardZ * 18),
    ])
    mesh(table, new THREE.TubeGeometry(bend, 24, 2.8, 6, false), materials.returnRail)
  }
}

function turnedProfile(points, segments) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

function timberBox(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * Math.max(width, depth), uv.getY(i) * height)
  return geometry
}

function makeBase(table, geo, materials, q8) {
  const hw = geo.W / 2
  const hz = geo.H / 2
  const legX = q8 ? [-hw + 137, 0, hw - 137] : [-hw + 155, -hw / 3, hw / 3, hw - 155]
  const legZ = hz - 39
  const railX = hw + 25
  const railZ = hz + 28
  const side = timberBox(2 * railX, 159, 44)
  const end = timberBox(47, 159, 2 * railZ)
  const lowerSide = new THREE.BoxGeometry(2 * railX + 4, 28, 47)
  const lowerEnd = new THREE.BoxGeometry(50, 28, 2 * railZ)
  for (const sign of [-1, 1]) {
    mesh(table, side, materials.apron, 0, -162, sign * railZ)
    mesh(table, end, materials.apron, sign * railX, -162)
    mesh(table, lowerSide, materials.trim, 0, -231, sign * railZ)
    mesh(table, lowerEnd, materials.trim, sign * railX, -231)
    if (q8) {
      for (const x of [-hw * 0.53, hw * 0.53]) {
        const face = sign * (railZ + 22)
        const hook = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x, -154, face),
          new THREE.Vector3(x + 28, -178, face + sign * 29),
          new THREE.Vector3(x + 67, -243, face + sign * 48),
          new THREE.Vector3(x + 85, -255, face + sign * 60),
          new THREE.Vector3(x + 95, -227, face + sign * 72),
        ])
        mesh(table, new THREE.TubeGeometry(hook, 24, 3.2, 7, false), materials.metal)
        mesh(table, new THREE.SphereGeometry(8, 12, 8), materials.trim, x, -155, face)
      }
    }
  }
  const block = new THREE.BoxGeometry(157, 210, 151)
  const blockFace = timberBox(106, 177, 3)
  const contact = new THREE.PlaneGeometry(292, 267).rotateX(-Math.PI / 2)
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: texture(64, 64, (ctx) => {
      const shadow = ctx.createRadialGradient(32, 32, 9, 32, 32, 32)
      shadow.addColorStop(0, 'rgba(0,0,0,0.76)')
      shadow.addColorStop(0.65, 'rgba(0,0,0,0.24)')
      shadow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = shadow
      ctx.fillRect(0, 0, 64, 64)
    }),
    transparent: true,
    depthWrite: false,
  })
  const bottom = turnedProfile([
    [0, TABLE_FLOOR], [76, TABLE_FLOOR], [81, -782], [84, -768],
    [91, -761], [100, -747], [101, -731], [91, -716], [76, -711], [80, -700],
  ], 32)
  const center = turnedProfile([
    [77, -701], [91, -682], [102, -622], [112, -532], [115, -468],
    [107, -443], [91, -432],
  ], 8)
  const facetMaterial = materials.leg.clone()
  facetMaterial.flatShading = true
  const crown = turnedProfile([
    [91, -433], [82, -425], [82, -407], [97, -396], [112, -381],
    [115, -362], [108, -345], [87, -331], [83, -318], [88, -296],
    [99, -285], [100, -273], [93, -263],
  ], 32)
  const inset = new THREE.Shape()
  inset.moveTo(-23, -671)
  inset.lineTo(-29, -647)
  inset.lineTo(-32, -485)
  inset.lineTo(-21, -463)
  inset.lineTo(23, -463)
  inset.lineTo(33, -485)
  inset.lineTo(28, -647)
  inset.lineTo(20, -671)
  inset.closePath()
  const insetGeometry = new THREE.ExtrudeGeometry(inset, {
    depth: 1.4, bevelEnabled: true, bevelThickness: 2.8, bevelSize: 2.7, bevelSegments: 2,
  })
  const insetPositions = insetGeometry.getAttribute('position')
  for (let i = 0; i < insetPositions.count; i++) {
    const z = insetPositions.getZ(i)
    insetPositions.setZ(i, z + 91 + (insetPositions.getY(i) + 670) * 0.084)
  }
  insetGeometry.computeVertexNormals()
  for (const sign of [-1, 1]) {
    for (const x of legX) {
      const z = sign * legZ
      mesh(table, block, materials.trim, x, -192, z)
      mesh(table, blockFace, materials.apron, x, -173, z + sign * 76)
      mesh(table, contact, contactMaterial, x, TABLE_FLOOR + 2, z)
      const leg = new THREE.Group()
      leg.position.set(x, 0, z)
      leg.name = 'diamond-leg'
      table.add(leg)
      mesh(leg, bottom, materials.leg)
      mesh(leg, center, facetMaterial)
      mesh(leg, crown, materials.leg)
      if (q8) {
        for (let i = 0; i < 8; i++) {
          const face = mesh(leg, insetGeometry, [materials.legInset, materials.legBevel])
          face.rotation.y = Math.PI / 8 + i * Math.PI / 4
        }
      }
    }
  }
}

function addRailSights(table, geo, railX, railY, material) {
  const sight = new THREE.CircleGeometry(5.4, 4).rotateX(-Math.PI / 2)
  const { W, H } = geo
  function addSight(x, y) {
    mesh(table, sight, material, toWorldX(geo, x), RAIL_TOP + 0.13, toWorldZ(geo, y))
  }
  for (const x of [W / 8, W / 4, 3 * W / 8, 5 * W / 8, 3 * W / 4, 7 * W / 8])
    for (const y of [-railY * 0.71, H + railY * 0.71]) addSight(x, y)
  for (const y of [H / 4, H / 2, 3 * H / 4])
    for (const x of [-railX * 0.71, W + railX * 0.71]) addSight(x, y)
}

function shadePlayingCloth(material, geo) {
  const isSnk = geo.mode === 'snk'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clothHalfSize = { value: new THREE.Vector2(geo.W / 2, geo.H / 2) }
    shader.uniforms.clothPockets = { value: new THREE.Vector3(geo.PR[0][2] * 0.85, geo.PR[1][2] * 0.85, geo.py) }
    shader.uniforms.clothMark = { value: new THREE.Vector2(
      toWorldX(geo, isSnk ? BX : geo.W / 4), isSnk ? DR : 0,
    ) }
    shader.uniforms.clothSpots = { value: new THREE.Vector4(
      0,
      toWorldX(geo, geo.W * 0.75),
      toWorldX(geo, geo.W - 324),
      isSnk ? 1 : 0,
    ) }
    shader.vertexShader = `varying vec2 clothPosition;
${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nclothPosition = position.xz;')}`
    shader.fragmentShader = `varying vec2 clothPosition;
uniform vec2 clothHalfSize;
uniform vec3 clothPockets;
uniform vec2 clothMark;
uniform vec4 clothSpots;
float clothHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float clothNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(point));
  return mix(mix(clothHash(cell), clothHash(cell + vec2(1.0, 0.0)), f.x),
    mix(clothHash(cell + vec2(0.0, 1.0)), clothHash(cell + vec2(1.0)), f.x), f.y);
}
float chalkStroke(float distance, float pixelWidth) {
  float aa = max(pixelWidth, 0.001);
  float halfWidth = max(1.15, aa * 0.6);
  return 1.0 - smoothstep(halfWidth - aa * 0.5, halfWidth + aa * 0.5, abs(distance));
}
float spotDot(vec2 pos, vec2 center, float radius) {
  float d = length(pos - center);
  float aa = max(fwidth(d), 0.35);
  return 1.0 - smoothstep(radius - aa, radius + aa, d);
}
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  vec2 clothEdge = clothHalfSize - abs(clothPosition);
  float railShade = 0.44 * exp(-max(0.0, min(clothEdge.x, clothEdge.y)) / 24.0);
  // 转播级双排灯箱分布：台面中央明亮通透，四周自然压暗，叠加双排柔光亮带
  vec2 clothRel = clothPosition / clothHalfSize;
  float lampFalloff = 1.0 - 0.34 * smoothstep(0.14, 1.04, length(clothRel));
  float bandDist = abs(abs(clothRel.y) - 0.36);
  lampFalloff *= 0.92 + 0.18 * exp(-bandDist * bandDist * 13.0);
  float cornerDistance = length(clothEdge) - clothPockets.x;
  float sideDistance = length(vec2(clothPosition.x, clothEdge.y + clothPockets.z)) - clothPockets.y;
  float lipShade = 0.28 * exp(-max(0.0, min(cornerDistance, sideDistance)) / 11.0);
  // 远处用导数衰减高频噪声，避免斜视时出现摩尔纹
  float fineFade = 1.0 - smoothstep(1.2, 3.2, fwidth(clothPosition.x) + fwidth(clothPosition.y));
  float fineGrain = clothNoise(clothPosition / vec2(3.2, 3.2)) - 0.5;
  float nap = 0.99 + fineGrain * 0.032 * fineFade;
  // 绒毛掠射光泽：顺着视线看过去时台呢微微提亮，还原羊毛台呢丝绒感
  float grazing = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 1.65);
  float warm = smoothstep(0.0, 1.0, 1.0 - length(clothPosition / clothHalfSize));
  vec3 grade = mix(vec3(0.92, 0.975, 1.03), vec3(1.045, 1.015, 0.968), warm);
  diffuseColor.rgb *= (1.0 - railShade) * (1.0 - lipShade) * lampFalloff * nap * grade
    * (1.0 + grazing * 0.16);

  vec2 fromLine = clothPosition - vec2(clothMark.x, 0.0);
  float mark = chalkStroke(fromLine.x, fwidth(fromLine.x));
  float arcDistance = length(fromLine) - clothMark.y;
  float arcMark = chalkStroke(arcDistance, fwidth(arcDistance));
  if (clothMark.y > 0.0 && fromLine.x < 0.0) {
    mark = max(mark, arcMark);
  }
  // 斯诺克 6 个官方置球点（黑、粉、蓝、棕、绿、黄）
  if (clothSpots.w > 0.5) {
    float spots = 0.0;
    spots = max(spots, spotDot(clothPosition, vec2(clothSpots.x, 0.0), 5.2));
    spots = max(spots, spotDot(clothPosition, vec2(clothSpots.y, 0.0), 5.2));
    spots = max(spots, spotDot(clothPosition, vec2(clothSpots.z, 0.0), 5.2));
    spots = max(spots, spotDot(clothPosition, vec2(clothMark.x, 0.0), 4.6));
    spots = max(spots, spotDot(clothPosition, vec2(clothMark.x, clothMark.y), 4.6));
    spots = max(spots, spotDot(clothPosition, vec2(clothMark.x, -clothMark.y), 4.6));
    mark = max(mark, spots * 1.15);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.65, 0.54), clamp(mark * 0.34, 0.0, 0.55));
`)}
`
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  {
    float detailFade = 1.0 - smoothstep(0.8, 2.4, fwidth(clothPosition.x) + fwidth(clothPosition.y));
    vec2 fp = clothPosition / 1.6;
    float h0 = clothNoise(fp);
    float hx = clothNoise(fp + vec2(1.0, 0.0));
    float hz = clothNoise(fp + vec2(0.0, 1.0));
    vec2 grad = vec2(hx - h0, hz - h0) * 4.0 * detailFade;
    vec3 fiberNormal = normalize((viewMatrix * vec4(normalize(vec3(-grad.x, 1.0, -grad.y)), 0.0)).xyz);
    normal = normalize(normal + fiberNormal * 0.12);
  }`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.03, 0.052, 0.038) * grazing;`,
    )
  }
}

export function createTable(geo, maps) {
  const table = new THREE.Group()
  const q8 = geo.mode !== 'snk'
  table.name = q8 ? 'JOY Q8 table' : 'Snooker table'
  const [rx, ry] = tableMargins(geo)
  const outer = [geo.W / 2 + rx, geo.H / 2 + ry]
  const material = (color, roughness, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color: surfaceColor(color), roughness, metalness })
  const lacquer = new THREE.MeshPhysicalMaterial({
    map: maps.wood, normalMap: maps.woodNormal, normalScale: new THREE.Vector2(0.36, 0.36),
    color: surfaceColor(q8 ? 0x8e655c : 0x6f3124), roughness: q8 ? 0.29 : 0.22,
    clearcoat: q8 ? 0.65 : 0.85, clearcoatRoughness: q8 ? 0.25 : 0.16,
    envMapIntensity: q8 ? 0.54 : 0.72,
  })
  const apron = new THREE.MeshStandardMaterial({
    color: surfaceColor(q8 ? 0xa16b61 : 0x5c271d), map: maps.wood, normalMap: maps.woodNormal,
    normalScale: new THREE.Vector2(0.26, 0.26), roughness: 0.38, envMapIntensity: 0.45,
  })
  const colors = {
    apron,
    trim: material(q8 ? 0xc2a071 : 0x8c633c, 0.3, q8 ? 0.68 : 0.45),
    leg: material(q8 ? 0xaa8054 : 0x4c241b, 0.32, q8 ? 0.59 : 0.15),
    legInset: material(0x8e6847, 0.47, 0.43),
    legBevel: material(0xbb9063, 0.27, 0.59),
    metal: material(q8 ? 0xc4a270 : 0xcfa75e, q8 ? 0.27 : 0.22, q8 ? 0.72 : 0.86),
    leather: new THREE.MeshStandardMaterial({
      color: surfaceColor(q8 ? 0xe7d5bc : 0x563222), map: maps.leather,
      normalMap: maps.leatherNormal, normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.62, vertexColors: true,
    }),
    returnRail: material(0x373932, 0.33, 0.71),
    liner: new THREE.MeshStandardMaterial({
      color: surfaceColor(0x2e2118), normalMap: maps.leatherNormal, side: THREE.DoubleSide, roughness: 0.89,
    }),
    net: material(0xd9d0b9, 0.93),
    thread: material(0xf6e9d1, 0.91),
    pocketDark: new THREE.MeshBasicMaterial({ color: surfaceColor(0x0b0908) }),
  }
  const cloth = new THREE.MeshPhysicalMaterial({
    color: surfaceColor(q8 ? 0x16412b : 0x134b2e), roughness: 0.85, bumpMap: maps.cloth, bumpScale: 0.2,
    clearcoat: 0.18, clearcoatRoughness: 0.8,
    sheen: surfaceColor(0x284032), reflectivity: 0.22, envMapIntensity: 0.32,
  })
  const cushion = cloth.clone()
  cushion.color = surfaceColor(q8 ? 0x163f2b : 0x12472b)
  cushion.side = THREE.DoubleSide
  cushion.bumpScale = 0.22
  const foldedCloth = cushion.clone()
  foldedCloth.color.multiplyScalar(0.66)
  shadePlayingCloth(cloth, geo)
  makeBed(table, geo, cloth, foldedCloth)
  for (const outline of geo.cushions)
    mesh(table, makeCushion(geo, outline), cushion).name = 'cushion'

  const frame = roundedFrame(outer[0] - 4, outer[1] - 4, 44)
  frame.holes.push(pocketOutline(geo, CUSHION_DEPTH, false).path)
  extrude(table, frame, lacquer, 22, 35, 4)
  extrude(table, frame, colors.trim, -45, 63, 2)
  extrude(table, frame, lacquer, -61, 12, 3)
  for (const pocket of geo.PR) makePocket(table, geo, pocket, outer, colors, q8)
  makeBase(table, geo, colors, q8)
  if (q8) addRailSights(table, geo, rx, ry, material(0xd5d4b2, 0.23, 0.16))

  if (q8) {
    const logo = texture(512, 96, (ctx) => {
      ctx.fillStyle = '#211c18'
      ctx.font = 'italic 800 56px Arial, sans-serif'
      ctx.fillText('JOY', 14, 68)
      ctx.font = '600 46px "PingFang SC", sans-serif'
      ctx.fillText('乔氏', 152, 68)
      ctx.fillRect(272, 26, 2, 43)
      ctx.font = '700 38px Arial, sans-serif'
      ctx.fillText('Q8', 294, 66)
    })
    logo.encoding = THREE.sRGBEncoding
    const badge = new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false, toneMapped: false })
    const badgeGeometry = new THREE.PlaneGeometry(233, 44)
    for (const side of [-1, 1]) {
      const label = mesh(table, badgeGeometry, badge, -side * geo.W * 0.25, -13, side * (outer[1] + 0.8))
      if (side < 0) label.rotation.y = Math.PI
    }
  } else {
    // 斯诺克锦标赛黄铜铭牌
    const plaque = texture(512, 96, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 512, 96)
      grad.addColorStop(0, '#a88342')
      grad.addColorStop(0.5, '#e2c27d')
      grad.addColorStop(1, '#967236')
      ctx.fillStyle = grad
      ctx.fillRect(4, 8, 504, 80)
      ctx.strokeStyle = '#3b2810'
      ctx.lineWidth = 4
      ctx.strokeRect(10, 14, 492, 68)
      ctx.fillStyle = '#231708'
      ctx.font = '700 30px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('CHAMPIONSHIP · 12FT', 256, 49)
    })
    plaque.encoding = THREE.sRGBEncoding
    const plaqueMat = new THREE.MeshStandardMaterial({
      map: plaque, roughness: 0.28, metalness: 0.72,
    })
    const plaqueGeo = new THREE.PlaneGeometry(260, 48)
    for (const side of [-1, 1]) {
      const plate = mesh(table, plaqueGeo, plaqueMat, 0, -14, side * (outer[1] + 0.9))
      if (side < 0) plate.rotation.y = Math.PI
    }
  }
  table.traverse((part) => {
    if (!part.isMesh || part.material.transparent) return
    part.castShadow = true
    part.receiveShadow = true
  })
  return table
}

export function createTableEnvironment(renderer) {
  const room = new THREE.Scene()
  room.background = surfaceColor(0x1b1e21)
  function softbox(width, height, color, intensity, x, y, z) {
    const light = mesh(room, new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
      color: surfaceColor(color).multiplyScalar(intensity), side: THREE.DoubleSide,
    }), x, y, z)
    light.lookAt(0, 0, 0)
  }
  // 克鲁斯堡双排转播柔光灯带：在树脂球面上映射出锐利的双条职业高光
  softbox(12, 0.95, 0xfff5e0, 5.6, 0, 6.2, -1.85)
  softbox(12, 0.95, 0xfff5e0, 5.6, 0, 6.2, 1.85)
  // 中央柔光漫反射补充
  softbox(10, 2.2, 0xf4f0e4, 1.4, 0, 7.2, 0)
  // 四周微弱的赛场冷暖环境轮廓反射
  softbox(7.5, 1.4, 0xcadff5, 1.05, 2.5, 1.6, 6.4)
  softbox(5.0, 2.4, 0xffd09c, 1.05, -5.8, 0.9, -2.4)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(room, 0.06, 0.1, 32)
  pmrem.dispose()
  for (const light of room.children) {
    light.geometry.dispose()
    light.material.dispose()
  }
  return environment
}

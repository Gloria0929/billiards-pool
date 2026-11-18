import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { AIM_NUDGE, AIM_NUDGE_FINE, COL, DT, MAX_SIM_STEPS, MODES, SC, clamp } from './constants.js'
import { getGeometry, toWorldX, toWorldZ } from './geometry.js'
import { canPlaceCue, moving, step } from './physics.js'
import { buildAimGuide } from './guide.js'
import { launchShot } from './match.js'
import { createTable, createTableEnvironment, tableMargins, TABLE_FLOOR } from './table.js'
import { createRoomShell, loadTableMaps, surfaceColor } from './table-materials.js'
import * as audio from './audio.js'

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
const POCKET_DROP_TIME = 0.5

// 九球专用配色（0 为白球，1-8 为 1-8 号球，9 号由白底 + 1 号色条纹生成）
const NINE_COL = [
  '#f7f1e0', // 白球
  '#f2bf00', // 1 黄
  '#0f4fd6', // 2 蓝
  '#c8102e', // 3 红
  '#6f2ec4', // 4 紫
  '#e2650a', // 5 橙（压暗与黄区分）
  '#0a8a45', // 6 绿
  '#5e2a1a', // 7 棕
  '#141414', // 8 黑
]

export class BilliardsEngine {
  constructor(canvas) {
    this.canvas = canvas
    this.container = canvas.parentElement || canvas
    this.state = null
    this.geo = getGeometry('pool')
    this.meshes = new Map()
    this.sg = null
    this.tg = null
    this.animating = false
    this.interactionEnabled = false
    this.overlayOpen = true
    this.acc = 0
    this.simTime = 0
    this.last = performance.now()
    this.view = 'orbit'
    this.orbitYaw = 0.45
    this.orbitPitch = 0.50
    this.orbitZoom = 1
    this.camH = 270
    this.camD = 560
    this.cueTh = 0.07
    this.cameraReady = false
    this.showGuide = true
    this.guideMode = 'simple'
    this.power = 0.45
    this.playerPower = null
    this.spin = { x: 0, y: 0 }
    this.playerSpin = { x: 0, y: 0 }
    this.angle = 0
    this.strikeT = 0
    this.strikeProgress = 0
    this.striking = false
    this.pendingShot = null
    this.disposed = false
    this.drag = false
    this.aiming = false
    this.pull = null
    this.space = null
    this.pointers = new Map()
    this.pinchDistance = 0
    this.wasPinch = false
    this.lastX = 0
    this.lastY = 0
    this.startX = 0
    this.startY = 0
    this.orbitDragging = false
    this.onShoot = null
    this.onRest = null
    this.onPower = null
    this.onCharge = null
    this.onPhase = null
    this.onView = null
    this.onSpin = null
    this.onError = null
    this.onReady = null
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    this.initScene()
    this.bindInput()
    this.observeResize()
    this.loop = this.loop.bind(this)
    requestAnimationFrame(this.loop)
  }

  /* ---------- 场景 ---------- */
  initScene() {
    this.renderer = null
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
      })
    } catch (error) {
      this.onError?.(error)
      return
    }
    const rd = this.renderer
    rd.outputEncoding = THREE.sRGBEncoding
    rd.toneMapping = THREE.ACESFilmicToneMapping
    rd.toneMappingExposure = 1
    rd.shadowMap.enabled = true
    rd.shadowMap.type = THREE.VSMShadowMap
    rd.shadowMap.autoUpdate = false
    this.tableMaps = loadTableMaps(rd.capabilities.getMaxAnisotropy())
    this.tableMapTextures = new Set(Object.values(this.tableMaps))
    this.scene = new THREE.Scene()
    this.scene.background = surfaceColor(0x141917)
    this.scene.fog = new THREE.Fog(this.scene.background, 5800, 17600)
    this.cam = new THREE.PerspectiveCamera(50, 1, 10, 12000)
    this.tableEnvironment = createTableEnvironment(rd)
    this.scene.environment = this.tableEnvironment.texture
    this.scene.add(new THREE.HemisphereLight(0xe8eef2, 0x836f5a, 0.68))
    this.sun = new THREE.SpotLight(0xffefd9, 1.95, 6300, 0.82, 0.74, 1)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1536, 1536)
    this.sun.shadow.radius = 8
    this.sun.shadow.normalBias = 2.3
    this.sun.shadow.bias = -0.00022
    this.sun.shadow.camera.near = 1050
    this.scene.add(this.sun, this.sun.target)
    const fill = new THREE.DirectionalLight(0xd1dfed, 0.37)
    fill.position.set(1400, 1150, -1450)
    this.scene.add(fill)

    this.bg = new THREE.Group()
    this.scene.add(this.bg)

    this.desiredCam = new THREE.PerspectiveCamera()
    this.cameraTarget = new THREE.Vector3()
    this.raycaster = new THREE.Raycaster()
    this.groundPlane = new THREE.Plane(V3(0, 1, 0), 0)
    this.aimBackVector = new THREE.Vector2()

    this.blobTexture = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const x = c.getContext('2d')
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(0,0,0,.6)')
      g.addColorStop(0.4, 'rgba(0,0,0,.4)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      x.fillStyle = g
      x.fillRect(0, 0, 128, 128)
      return new THREE.CanvasTexture(c)
    })()
    this.blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    this.blobMat = new THREE.MeshBasicMaterial({
      map: this.blobTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })

    this.tableStage = new THREE.Group()
    this.scene.add(this.tableStage)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(46000, 46000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: this.tableMaps.floor, color: surfaceColor(0x746b61),
        roughness: 0.77, envMapIntensity: 0.19,
      }),
    )
    ground.position.y = TABLE_FLOOR
    ground.receiveShadow = true
    this.tableStage.add(ground, createRoomShell(TABLE_FLOOR, this.tableMaps))
    this.tableShadow = new THREE.Mesh(this.blobGeo, new THREE.MeshBasicMaterial({
      map: this.blobTexture, transparent: true, depthWrite: false, opacity: 0.51,
    }))
    this.tableShadow.position.y = TABLE_FLOOR + 1
    this.tableStage.add(this.tableShadow)

    this.aimGroup = new THREE.Group()
    const guideLine = (color, dashed = false) => {
      const material = new LineMaterial({
        color: surfaceColor(color), transparent: true, opacity: 0.91, toneMapped: false,
        linewidth: dashed ? 1.5 : 1.8, dashSize: 22, gapSize: 14,
      })
      if (dashed) material.defines.USE_DASH = ''
      const m = new Line2(new LineGeometry(), material)
      m.visible = false
      m.frustumCulled = false
      this.aimGroup.add(m)
      return m
    }
    this.lineA = guideLine(0xffffff)
    this.lineB = guideLine(0xffe38a)
    this.lineC = guideLine(0xffffff)
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
      }),
    )
    this.aimGroup.add(this.ghost)

    this.bankCueLine = guideLine(0x8fd6ff, true)
    this.bankObjectLine = guideLine(0xffd479, true)

    const pocketRing = new THREE.RingGeometry(0.72, 1, 36)
    const pocketMark = (color) => {
      const mark = new THREE.Mesh(
        pocketRing,
        new THREE.MeshBasicMaterial({
          color: surfaceColor(color),
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false, toneMapped: false,
        }),
      )
      mark.rotation.x = -Math.PI / 2
      mark.visible = false
      this.aimGroup.add(mark)
      return mark
    }
    this.cuePocketMark = pocketMark(0x8fd6ff)
    this.objectPocketMark = pocketMark(0xffd479)

    this.scene.add(this.aimGroup)

    this.cueGroup = new THREE.Group()
    const cueMaterial = (c, s) =>
      new THREE.MeshPhongMaterial({ color: surfaceColor(c), shininess: s || 10 })
    this.cueShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 9, 900, 10),
      cueMaterial(0xe0bd82, 40),
    )
    this.cueButt = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 15, 800, 10),
      cueMaterial(0x1c120a, 40),
    )
    this.cueShaft.position.y = -450
    this.cueButt.position.y = -1300
    this.cueShaft.castShadow = this.cueButt.castShadow = false
    this.cueGroup.add(this.cueShaft, this.cueButt)
    this.scene.add(this.cueGroup)

    this.spinQuat = new THREE.Quaternion()
    this.spinAxis = new THREE.Vector3()
    this.resize()
  }

  /* ---------- 球与球桌资源 ---------- */

  // 九球专用球面：比黑八那套更亮的电视配色，号码用细圈 + 数字，不加大白圆贴。
  nineBallTexture(n) {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const x = c.getContext('2d')
    if (n > 8) {
      x.fillStyle = '#f5f1e4'
      x.fillRect(0, 0, 512, 256)
      x.fillStyle = NINE_COL[n - 8]
      x.fillRect(0, 52, 512, 152)
    } else {
      x.fillStyle = NINE_COL[n]
      x.fillRect(0, 0, 512, 256)
    }
    if (n > 0) {
      const ink = n === 1 || n === 5 || n === 9 ? '#1a160e' : '#f8f5ec'
      for (const u of [128, 384]) {
        x.globalAlpha = 0.55
        x.strokeStyle = ink
        x.lineWidth = 2.6
        x.beginPath()
        x.arc(u, 128, 42, 0, Math.PI * 2)
        x.stroke()
        x.globalAlpha = 1
        x.fillStyle = ink
        x.font = '600 60px "Helvetica Neue", Helvetica, Arial, sans-serif'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.fillText(n, u, 132)
      }
    }
    const map = new THREE.CanvasTexture(c)
    map.encoding = THREE.sRGBEncoding
    return map
  }

  ballTexture(n) {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const x = c.getContext('2d')
    x.fillStyle = n > 8 ? COL[0] : COL[n]
    x.fillRect(0, 0, 512, 256)
    if (n > 8) {
      x.fillStyle = COL[n - 8]
      x.fillRect(0, 85, 512, 86)
    }
    if (n > 0)
      for (const u of [128, 384]) {
        x.fillStyle = COL[0]
        x.beginPath()
        x.arc(u, 128, 38, 0, 7)
        x.fill()
        x.fillStyle = '#111'
        x.font = 'bold 44px sans-serif'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.fillText(n, u, 131)
      }
    else if (this.geo.mode === 'pool') {
      // 斯诺克与九球的白球是纯白色；红点只用于中式八球的红点练习球。
      x.fillStyle = '#c22'
      for (const u of [0, 128, 256, 384, 512]) {
        x.beginPath()
        x.arc(u, 128, 11, 0, 7)
        x.fill()
      }
    }
    const map = new THREE.CanvasTexture(c)
    map.encoding = THREE.sRGBEncoding
    return map
  }

  disposeGroup(group) {
    const geometries = new Set()
    const materials = new Set()
    group.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry)
      if (obj.material)
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) =>
          materials.add(m),
        )
    })
    geometries.forEach((g) => g.dispose())
    materials.forEach((m) => {
      if (m.map && !this.tableMapTextures?.has(m.map)) m.map.dispose()
      m.dispose()
    })
  }

  clearBalls() {
    for (const [, entry] of this.meshes) {
      this.bg.remove(entry.mesh)
      this.bg.remove(entry.shadow)
      if (entry.mesh.material.map) entry.mesh.material.map.dispose()
      entry.mesh.material.dispose()
    }
    this.meshes.clear()
  }

  buildTable() {
    if (this.tg) {
      this.scene.remove(this.tg)
      this.disposeGroup(this.tg)
    }
    const { W, H } = this.geo
    this.tg = createTable(this.geo, this.tableMaps)
    this.scene.add(this.tg)
    const [railX, railY] = tableMargins(this.geo)
    this.tableShadow.scale.set((W + railX * 2) * 1.48, 1, (H + railY * 2) * 1.72)
    this.sun.position.set(-350, this.geo.mode === 'snk' ? 2800 : 2420, 340)
    this.renderer.shadowMap.needsUpdate = true
  }

  createBallMesh(n) {
    const geo = this.geo
    const surface =
      geo.mode === 'nine'
        ? { map: this.nineBallTexture(n) }
        : geo.mode !== 'snk' || n === 0
          ? { map: this.ballTexture(n) }
          : { color: surfaceColor(n <= 15 ? 0xc0161b : SC[n - 16]) }
    const material = new THREE.MeshPhysicalMaterial({
      ...surface,
      // 九球弱化高光，让球色更实、更容易区分；中八保持原来的亮面。
      roughness: geo.mode === 'nine' ? 0.3 : 0.19,
      clearcoat: geo.mode === 'nine' ? 0.5 : 0.88,
      clearcoatRoughness: geo.mode === 'nine' ? 0.28 : 0.15,
      envMapIntensity: geo.mode === 'nine' ? 0.48 : 0.66,
    })
    const mesh = new THREE.Mesh(this.sg, material)
    mesh.castShadow = mesh.receiveShadow = true
    this.bg.add(mesh)
    const shadow = new THREE.Mesh(this.blobGeo, this.blobMat)
    shadow.renderOrder = 1
    this.bg.add(shadow)
    mesh.quaternion
      .setFromAxisAngle(Y_AXIS, Math.random() * 6.28)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -Math.PI / 2),
      )
    return { mesh, shadow }
  }

  loadMatch(state, { keepPlayerAim = false } = {}) {
    if (!this.renderer) return
    this.state = state
    this.geo = getGeometry(state.mode)
    this.clearBalls()
    if (this.sg) this.sg.dispose()
    this.sg = new THREE.SphereGeometry(this.geo.R, 32, 24)
    this.buildTable()
    for (const ball of state.balls) {
      const entry = this.createBallMesh(ball.n)
      entry.mesh.position.set(toWorldX(this.geo, ball.x), this.geo.R, toWorldZ(this.geo, ball.y))
      entry.shadow.position.set(toWorldX(this.geo, ball.x), 1.5, toWorldZ(this.geo, ball.y))
      entry.shadow.scale.setScalar(2.7 * this.geo.R)
      entry.mesh.visible = ball.on
      entry.shadow.visible = ball.on
      this.meshes.set(ball.n, entry)
    }
    this.animating = false
    this.striking = false
    this.strikeT = 0
    this.strikeProgress = 0
    this.pendingShot = null
    this.acc = 0
    if (!keepPlayerAim) {
      this.playerPower = null
      this.playerSpin = { x: 0, y: 0 }
    }
    this.setPower(this.playerPower ?? 0.45, false)
    this.setSpin(this.playerSpin, false)
    this.angle = 0
    this.orbitZoom = 1
    this.camH = 270
    this.camD = 560
    this.cameraReady = false
    this.resize()
    audio.rollSound(0)
  }

  applyState(state) {
    if (!this.state || state.mode !== this.state.mode || state.balls.length !== this.state.balls.length) {
      this.loadMatch(state)
      return
    }
    this.state = state
    this.animating = false
    this.acc = 0
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true
    for (const ball of state.balls) {
      const entry = this.meshes.get(ball.n)
      if (!entry) continue
      entry.mesh.visible = ball.on
      entry.shadow.visible = ball.on
      entry.mesh.position.set(
        toWorldX(this.geo, ball.x),
        this.geo.R,
        toWorldZ(this.geo, ball.y),
      )
      entry.shadow.position.set(
        toWorldX(this.geo, ball.x),
        1.5,
        toWorldZ(this.geo, ball.y),
      )
    }
    audio.rollSound(0)
  }

  playShot(shot) {
    if (!this.state) return
    launchShot(this.state, shot)
    this.animating = true
    this.striking = false
    this.strikeT = 0
    this.strikeProgress = 0
    this.acc = 0
    this.simTime = 0
    this.animSteps = 0
    this.onCharge?.(false)
    this.onPhase?.('moving')
    audio.ensureAudio()
    const spin = shot.spin || { x: 0, y: 0 }
    const speed =
      (200 + (shot.power ?? 0.45) * 8300) /
      (1 + 0.9 * (spin.x * spin.x + spin.y * spin.y))
    audio.playEvent('c', speed, 0, 'cue')
  }

  /* ---------- 相机 ---------- */
  setView(next) {
    this.view = next
    this.onView?.(next)
  }

  resetView() {
    this.orbitYaw = 0.45
    this.orbitPitch = 0.50
    this.orbitZoom = 1
    this.camH = 270
    this.camD = 560
  }

  zoomView(delta) {
    if (this.view === 'orbit')
      this.orbitZoom = Math.max(0.72, Math.min(1.6, this.orbitZoom * Math.exp(delta)))
    if (this.view === 'fp')
      this.camD = Math.max(220, Math.min(1200, this.camD * Math.exp(delta)))
  }

  cueTilt(c, dx, dy) {
    const { W, H, R } = this.geo
    let nearest = 1e9
    if (dx > 1e-6) nearest = Math.min(nearest, c.x / dx)
    else if (dx < -1e-6) nearest = Math.min(nearest, (W - c.x) / -dx)
    if (dy > 1e-6) nearest = Math.min(nearest, c.y / dy)
    else if (dy < -1e-6) nearest = Math.min(nearest, (H - c.y) / -dy)
    nearest = Math.max(nearest, R)
    const need = Math.max((56 - R) / nearest, (76 - R) / (nearest + 50), 0.07)
    return Math.min(0.8, Math.atan(need))
  }

  updCam(dt = 1 / 60) {
    if (!this.state || !this.state.balls.length) return
    const { W, H, R } = this.geo
    const desired = this.desiredCam
    desired.aspect = this.cam.aspect
    desired.near = 8
    desired.far = 40000
    const c =
      this.view === 'fp' && this.animating && this.state.shotAnchor
        ? this.state.shotAnchor
        : this.state.balls[0]
    const dx = Math.cos(this.angle)
    const dy = Math.sin(this.angle)
    if (this.view === 'fp') {
      desired.fov = 52
      desired.up.set(0, 1, 0)
      desired.position.set(
        toWorldX(this.geo, c.x) - dx * this.camD,
        Math.max(this.camH, R + this.camD * Math.tan(this.cueTh) + 80),
        toWorldZ(this.geo, c.y) + dy * this.camD,
      )
      this.cameraTarget.set(
        toWorldX(this.geo, c.x) + dx * 620,
        R,
        toWorldZ(this.geo, c.y) - dy * 620,
      )
    } else if (this.view === 'top') {
      desired.fov = 24
      const portrait = this.cam.aspect < 1
      const tf = Math.tan((24 * Math.PI) / 360)
      const hw = (portrait ? H : W) / 2 + 180
      const hh = (portrait ? W : H) / 2 + 180
      desired.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1)
      desired.position.set(
        0,
        Math.max(hh / tf, hw / (tf * this.cam.aspect)) * 1.09,
        0,
      )
      this.cameraTarget.set(0, 0, 0)
    } else {
      desired.fov = 42
      const portrait = this.cam.aspect < 1
      const yaw = this.orbitYaw + (portrait ? Math.PI / 2 : 0)
      const direction = V3(
        Math.sin(yaw) * Math.cos(this.orbitPitch),
        Math.sin(this.orbitPitch),
        Math.cos(yaw) * Math.cos(this.orbitPitch),
      )
      const right = V3(0, 1, 0).cross(direction).normalize()
      const up = direction.clone().cross(right).normalize()
      const tf = Math.tan((desired.fov * Math.PI) / 360)
      let distance = 0
      const [railX, railY] = tableMargins(this.geo)
      this.cameraTarget.set(0, -320, 0)
      const sections = [
        [W / 2 + railX + 8, H / 2 + railY + 8, 67],
        [W / 2 + 5, H / 2 + 79, -435],
        [W / 2 - 27, H / 2 + 65, TABLE_FLOOR],
      ]
      for (const [halfWidth, halfDepth, y] of sections)
        for (const x of [-halfWidth, halfWidth])
          for (const z of [-halfDepth, halfDepth]) {
            const p = V3(x, y - this.cameraTarget.y, z)
            const depth = p.dot(direction)
            distance = Math.max(
              distance,
              depth + Math.abs(p.dot(right)) / (tf * this.cam.aspect),
              depth + Math.abs(p.dot(up)) / tf,
            )
          }
      desired.up.set(0, 1, 0)
      desired.position.copy(this.cameraTarget).addScaledVector(direction, distance * 1.04 * this.orbitZoom)
    }
    desired.lookAt(this.cameraTarget)
    const blend =
      !this.cameraReady || this.reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 11)
    this.cam.position.lerp(desired.position, blend)
    this.cam.quaternion.slerp(desired.quaternion, blend)
    this.cam.fov += (desired.fov - this.cam.fov) * blend
    this.cam.near = desired.near
    this.cam.far = desired.far
    this.cam.updateProjectionMatrix()
    this.cam.updateMatrixWorld()
    this.cameraReady = true
  }

  /* ---------- 渲染 ---------- */
  render(dt) {
    if (!this.renderer || !this.state) return
    this.chargeTick(dt)
    const state = this.state
    const geo = this.geo
    const { R } = geo
    const tx = (x) => toWorldX(geo, x)
    const tz = (y) => toWorldZ(geo, y)
    for (const ball of state.balls) {
      const entry = this.meshes.get(ball.n)
      if (!entry) continue
      const m = entry.mesh
      if (ball.on) {
        m.visible = true
        m.position.set(tx(ball.x), R, tz(ball.y))
      } else if (ball.q && ball.st < POCKET_DROP_TIME) {
        const k = ball.st / POCKET_DROP_TIME
        const travel = 1 - Math.exp(-k * 4)
        m.visible = true
        m.position.set(
          tx(ball.x + (ball.q[0] - ball.x) * travel),
          R - 230 * k * k,
          tz(ball.y + (ball.q[1] - ball.y) * travel),
        )
        if (ball.fallSpin) {
          this.spinAxis.set(ball.fallSpin.y, 0, -ball.fallSpin.x).normalize()
          this.spinQuat.setFromAxisAngle(
            this.spinAxis,
            (ball.fallSpin.speed * dt) / R,
          )
          m.quaternion.premultiply(this.spinQuat)
        }
      } else m.visible = false
      entry.shadow.visible = ball.on
      entry.shadow.position.set(tx(ball.x), 1.5, tz(ball.y))
      entry.shadow.scale.setScalar(2.7 * R)
    }
    const cue = state.balls[0]
    if (this.animating || this.drag || this.shadowCueX !== cue.x || this.shadowCueY !== cue.y) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowCueX = cue.x
      this.shadowCueY = cue.y
    }

    const dragging = this.drag && state.phase === 'aim'
    const showCue = state.phase === 'aim' && cue.on && !dragging
    const { x: sideSpin, y: verticalSpin } = this.spin
    this.aimGroup.visible =
      this.showGuide && state.phase === 'aim' && cue.on && !dragging
    this.cueGroup.visible = showCue
    if (showCue) {
      const dx = Math.cos(this.angle)
      const dy = Math.sin(this.angle)
      const P = (x, y) => V3(tx(x), R, tz(y))
      if (this.aimGroup.visible) {
        const guide = this.getAimGuide()
        if (guide !== this.renderedGuide) {
          this.setGuideLine(this.lineA, guide.cuePath)
          this.setGuideLine(this.lineB, guide.object)
          this.setGuideLine(this.lineC, guide.deflect)
          this.ghost.visible = !!guide.hitBall
          this.ghost.position.copy(P(guide.ghost.x, guide.ghost.y))
          this.ghost.scale.setScalar(R)
          this.setGuideLine(this.bankCueLine, guide.cueBank)
          this.setGuideLine(this.bankObjectLine, guide.objectBank)
          this.setPocketMark(this.cuePocketMark, { pocket: guide.cuePocket })
          this.setPocketMark(this.objectPocketMark, { pocket: guide.objectPocket })
          this.renderedGuide = guide
        }
      }
      const strike = this.strikeProgress
      const gap = 3 + (11 + this.power * 260) * (1 - strike * strike)
      const th = this.cueTilt(cue, dx, dy)
      const axis = V3(dx * Math.cos(th), -Math.sin(th), -dy * Math.cos(th))
      const contact = P(cue.x, cue.y)
      if (sideSpin !== 0 || verticalSpin !== 0) {
        const right = V3(dy, 0, dx)
        const up = right.clone().cross(axis)
        const depth = R * Math.sqrt(1 - sideSpin ** 2 - verticalSpin ** 2)
        contact.addScaledVector(right, R * sideSpin)
          .addScaledVector(up, R * verticalSpin)
          .addScaledVector(axis, -depth)
      } else contact.addScaledVector(axis, -R)
      this.cueGroup.position.copy(contact).addScaledVector(axis, -gap)
      this.cueGroup.quaternion.setFromUnitVectors(Y_AXIS, axis)
      this.cueTh = th
    }

    this.updCam(dt)
    this.renderer.render(this.scene, this.cam)
  }

  getAimGuide() {
    const state = this.state
    const key = JSON.stringify([
      state.mode, state.breakShot, this.angle, this.power, this.spin.x, this.spin.y,
      this.guideMode,
      state.balls.map((b) => [b.n, b.on, b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz, b.m, b.mu]),
    ])
    if (this.aimGuideKey !== key) {
      this.aimGuide = buildAimGuide(this.geo, state.balls, this.angle, this.guideMode === 'full', {
        power: this.power, spin: this.spin, breakShot: state.breakShot,
      })
      this.aimGuideKey = key
    }
    return this.aimGuide
  }

  setGuideLine(line, route) {
    line.visible = !!route && route.points.length > 1
    if (!line.visible) return
    const points = route.points.flatMap((p) =>
      [toWorldX(this.geo, p.x), this.geo.R, toWorldZ(this.geo, p.y)])
    line.geometry.dispose()
    line.geometry = new LineGeometry().setPositions(points)
    line.computeLineDistances()
  }

  setPocketMark(mark, bank) {
    if (!bank || !bank.pocket) {
      mark.visible = false
      return
    }
    const pocket = bank.pocket
    mark.position.set(
      toWorldX(this.geo, pocket.x),
      1.2,
      toWorldZ(this.geo, pocket.y),
    )
    const scale = pocket.r * 0.85
    mark.scale.set(scale, scale, scale)
    mark.visible = true
  }

  spinBall(ball, elapsed) {
    const w = Math.hypot(ball.wx, ball.wy, ball.wz)
    const theta = w * elapsed
    if (theta < 1e-6) return
    this.spinAxis.set(ball.wx, ball.wz, -ball.wy).divideScalar(w)
    this.spinQuat.setFromAxisAngle(this.spinAxis, theta)
    const entry = this.meshes.get(ball.n)
    entry?.mesh.quaternion.premultiply(this.spinQuat)
  }

  resize() {
    if (!this.renderer) return
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    if (!cw || !ch) return
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.setSize(cw, ch, false)
    for (const line of [this.lineA, this.lineB, this.lineC, this.bankCueLine, this.bankObjectLine])
      line.material.resolution.set(cw, ch)
    this.cam.aspect = cw / ch
    this.cam.updateProjectionMatrix()
  }

  observeResize() {
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resizeBound = () => this.resize()
    window.addEventListener('resize', this.resizeBound)
  }

  loop(t) {
    if (this.disposed) return
    const dt = Math.min(0.05, (t - this.last) / 1000)
    this.last = t
    if (this.strikeT > 0) {
      this.strikeT += dt
      if (this.strikeT >= 0.1) {
        this.strikeT = 0
        this.strikeProgress = 0
        this.fire()
      } else this.strikeProgress = Math.min(1, this.strikeT / 0.1)
    }
    if (this.animating && this.state && !this.overlayOpen) {
      this.acc += dt
      const t0 = this.simTime
      while (this.acc >= DT && this.animSteps < MAX_SIM_STEPS && moving(this.state.balls)) {
        step(this.state)
        this.acc -= DT
        this.simTime += DT
        this.animSteps++
      }
      const elapsed = this.simTime - t0
      let maxSpeed = 0
      let dropping = false
      for (const ball of this.state.balls) {
        if (!ball.on) {
          if (ball.q && ball.st < POCKET_DROP_TIME) {
            ball.st = Math.min(POCKET_DROP_TIME, ball.st + dt)
            if (ball.st < POCKET_DROP_TIME) dropping = true
          }
          continue
        }
        this.spinBall(ball, elapsed)
        maxSpeed = Math.max(maxSpeed, Math.hypot(ball.vx, ball.vy))
      }
      this.drainEvents()
      audio.rollSound(maxSpeed)
      if (!dropping && (!moving(this.state.balls) || this.animSteps >= MAX_SIM_STEPS)) {
        this.animating = false
        this.acc = 0
        audio.rollSound(0)
        this.state.phase = 'aim'
        this.onRest?.(this.state)
      }
    }
    this.render(dt)
    requestAnimationFrame(this.loop)
  }

  drainEvents() {
    const events = this.state?.events
    if (!events || !events.length) return
    for (const event of events) {
      const world = V3(
        toWorldX(this.geo, event.x),
        this.geo.R,
        toWorldZ(this.geo, event.y),
      ).project(this.cam)
      const pan = Math.max(-0.8, Math.min(0.8, world.x * 0.8))
      audio.playEvent(event.k, event.s, pan, event.id)
    }
    events.length = 0
  }

  /* ---------- 输入 ---------- */
  bindInput() {
    const cv = this.canvas
    cv.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    cv.addEventListener('pointermove', (e) => this.onPointerMove(e))
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      cv.addEventListener(type, (e) => this.onPointerUp(e))
    cv.addEventListener(
      'wheel',
      (e) => {
        if (!this.overlayOpen && this.interactionEnabled) {
          e.preventDefault()
          this.zoomView(Math.max(-0.2, Math.min(0.2, e.deltaY * 0.001)))
        }
      },
      { passive: false },
    )
    cv.addEventListener('contextmenu', (e) => e.preventDefault())

    this.onBlur = () => {
      this.cancelSpace(true)
      this.endPull(null, true)
    }
    window.addEventListener('blur', this.onBlur)

    this.onKeyUp = (e) => {
      if (e.code === 'Space' && this.space) {
        e.preventDefault()
        this.releaseSpace(false)
      }
    }
    document.addEventListener('keyup', this.onKeyUp)

    this.onKeyDown = (e) => {
      if (this.overlayOpen) return
      if (e.key === 'Escape') {
        this.cancelSpace(true)
        this.endPull(null, true)
        return
      }
      if (e.target.matches?.('input')) return
      if (e.code === 'Space' && e.target.matches?.('button') && e.target.dataset.fire !== 'true')
        return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) this.pressSpace()
      }
      if (
        this.interactionEnabled &&
        this.state?.phase === 'aim' &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault()
        this.rotateAim((e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? AIM_NUDGE_FINE : AIM_NUDGE))
      }
      if (this.interactionEnabled && e.key.toLowerCase() === 'v')
        this.setView({ top: 'orbit', orbit: 'fp', fp: 'top' }[this.view])
    }
    document.addEventListener('keydown', this.onKeyDown)

    this.onVisibility = () => {
      if (document.hidden) {
        audio.suspendAudio()
      } else {
        this.last = performance.now()
      }
    }
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  acceptsInput() {
    return (
      this.state &&
      this.state.phase === 'aim' &&
      this.interactionEnabled &&
      !this.striking &&
      !this.overlayOpen
    )
  }

  pointToTable(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.raycaster.setFromCamera(
      {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      },
      this.cam,
    )
    this.groundPlane.constant = -this.geo.R
    const p = V3(0, 0, 0)
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null
    return { x: p.x + this.geo.W / 2, y: this.geo.H / 2 - p.z }
  }

  aimAt(p) {
    const cue = this.state.balls[0]
    if (p && Math.hypot(p.x - cue.x, p.y - cue.y) > this.geo.R)
      this.angle = Math.atan2(p.y - cue.y, p.x - cue.x)
  }

  onPointerDown(e) {
    if (!this.state || !['aim', 'moving'].includes(this.state.phase) || this.overlayOpen)
      return
    if (!this.interactionEnabled && this.state.phase !== 'moving') return
    if (e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey)) {
      e.preventDefault()
      this.startPull(e)
      return
    }
    audio.ensureAudio()
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 2) {
      const ps = [...this.pointers.values()]
      this.pinchDistance = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
      this.wasPinch = true
      this.drag = this.aiming = false
      return
    }
    this.lastX = this.startX = e.clientX
    this.lastY = this.startY = e.clientY
    this.orbitDragging = false
    this.wasPinch = false
    if (this.state.phase === 'aim' && this.view !== 'fp' && this.interactionEnabled) {
      const p = this.pointToTable(e)
      const cue = this.state.balls[0]
      if (
        this.state.inHand &&
        p &&
        Math.hypot(p.x - cue.x, p.y - cue.y) < this.geo.R * 2.2
      ) {
        this.drag = true
        return
      }
      this.aiming = true
      if (this.view === 'top') this.aimAt(p)
    } else this.aiming = true
  }

  onPointerMove(e) {
    if (this.pull) {
      this.movePull(e)
      return
    }
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size >= 2) {
      const ps = [...this.pointers.values()]
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
      if (this.pinchDistance > 0 && d > 0)
        this.zoomView(Math.log(this.pinchDistance / d))
      this.pinchDistance = d
      return
    }
    if (this.wasPinch) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    if (this.drag && this.state.phase === 'aim') {
      const p = this.pointToTable(e)
      const cue = this.state.balls[0]
      if (p && this.state.inHand && this.geo && this.canPlaceCue(p)) {
        cue.x = p.x
        cue.y = p.y
      }
    } else if (this.aiming) {
      if (this.view === 'top' && this.state.phase === 'aim')
        this.aimAt(this.pointToTable(e))
      else if (this.view === 'orbit') {
        if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 6)
          this.orbitDragging = true
        if (this.orbitDragging) {
          this.orbitYaw -= dx * 0.006
          this.orbitPitch = Math.max(0.38, Math.min(1.38, this.orbitPitch + dy * 0.005))
        }
      } else if (this.view === 'fp' && this.state.phase === 'aim') {
        this.angle -= dx * 0.0025
        this.camH = Math.max(100, Math.min(850, this.camH - dy * 1.1))
      }
    }
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  canPlaceCue(p) {
    return canPlaceCue(this.state, p.x, p.y)
  }

  onPointerUp(e) {
    if (this.pull) {
      this.endPull(e, e.type === 'pointercancel')
      return
    }
    if (
      e.type === 'pointerup' &&
      this.view === 'orbit' &&
      this.aiming &&
      !this.orbitDragging &&
      !this.wasPinch &&
      this.state?.phase === 'aim'
    )
      this.aimAt(this.pointToTable(e))
    this.pointers.delete(e.pointerId)
    this.drag = this.aiming = false
    if (!this.pointers.size) {
      this.pinchDistance = 0
      this.wasPinch = false
    }
  }

  /* ---------- 蓄力 ---------- */
  emitPower() {
    this.onPower?.(this.power, this.playerPower)
  }

  // 蓄力预览和对手瞄准只改当前显示。
  setPower(value, own = true) {
    this.power = clamp(value, 0.01, 1)
    if (own) this.playerPower = this.power
    this.emitPower()
  }

  setSpin(spin, own = true) {
    this.spin = {
      x: clamp(spin.x, -0.65, 0.65),
      y: clamp(spin.y, -0.65, 0.65),
    }
    if (own) this.playerSpin = this.spin
    this.onSpin?.(this.spin, this.playerSpin)
  }

  rotateAim(delta) {
    if (this.state?.phase === 'aim') this.angle += delta
  }

  aimBackVector() {
    const cue = this.state.balls[0]
    const rect = this.canvas.getBoundingClientRect()
    const a = V3(toWorldX(this.geo, cue.x), this.geo.R, toWorldZ(this.geo, cue.y)).project(
      this.cam,
    )
    const b = V3(
      toWorldX(this.geo, cue.x + Math.cos(this.angle) * 300),
      this.geo.R,
      toWorldZ(this.geo, cue.y + Math.sin(this.angle) * 300),
    ).project(this.cam)
    const x = ((a.x - b.x) * rect.width) / 2
    const y = (-(a.y - b.y) * rect.height) / 2
    const len = Math.hypot(x, y)
    return len < 1 ? { x: 0, y: 1 } : { x: x / len, y: y / len }
  }

  startPull(e) {
    if (!this.acceptsInput() || this.space) return
    audio.ensureAudio()
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = this.aiming = false
    this.pull = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      k: this.aimBackVector(),
      p0: this.power,
      d: 0,
    }
    this.onCharge?.(true)
  }

  movePull(e) {
    if (!this.pull || e.pointerId !== this.pull.id) return
    const full = Math.max(
      160,
      Math.min(320, Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * 0.4),
    )
    this.pull.d =
      (e.clientX - this.pull.x) * this.pull.k.x +
      (e.clientY - this.pull.y) * this.pull.k.y
    this.setPower(this.pull.d < 8 ? 0.01 : Math.min(1, 0.02 + (this.pull.d / full) * 0.98), false)
  }

  endPull(e, cancel) {
    if (!this.pull || (e && e.pointerId !== this.pull.id)) return
    const ok = !cancel && this.pull.d >= 14 && this.state?.phase === 'aim'
    if (!ok) this.setPower(this.pull.p0, false)
    this.pull = null
    this.onCharge?.(false)
    if (ok) this.shoot()
  }

  pressSpace() {
    if (!this.acceptsInput() || this.space || this.pull) return
    audio.ensureAudio()
    this.space = { t: 0, p0: this.power }
    this.onCharge?.(true)
  }

  cancelSpace(reset) {
    if (!this.space) return
    const s = this.space
    this.space = null
    if (reset) this.setPower(s.p0, false)
    this.onCharge?.(false)
  }

  releaseSpace(cancel) {
    if (!this.space) return
    const s = this.space
    this.space = null
    if (cancel || s.t <= 0.22) this.setPower(s.p0, false)
    this.onCharge?.(false)
    if (!cancel && this.state?.phase === 'aim') this.shoot()
  }

  chargeTick(dt) {
    if (!this.space) return
    if (this.state?.phase !== 'aim') {
      this.space = null
      this.onCharge?.(false)
      return
    }
    this.space.t += dt
    if (this.space.t > 0.22) {
      const u = ((this.space.t - 0.22) / 1.5) % 2
      this.setPower(0.03 + 0.97 * (u < 1 ? u : 2 - u), false)
    }
  }

  shoot() {
    if (!this.acceptsInput() || !this.state || this.striking) return
    audio.ensureAudio()
    this.playerPower = this.power
    this.emitPower()
    const shot = {
      angle: this.angle,
      power: this.power,
      spin: { x: this.spin.x, y: this.spin.y },
      cue: { x: this.state.balls[0].x, y: this.state.balls[0].y },
    }
    this.pendingShot = shot
    this.striking = true
    this.strikeT = 0.0001
    this.strikeProgress = 0
    this.onShoot?.(shot)
  }

  fire() {
    const shot =
      this.pendingShot ||
      (this.state && {
        angle: this.angle,
        power: this.power,
        spin: { x: this.spin.x, y: this.spin.y },
        cue: { x: this.state.balls[0].x, y: this.state.balls[0].y },
      })
    this.pendingShot = null
    this.striking = false
    this.strikeT = 0
    this.strikeProgress = 0
    if (!shot || this.state?.phase !== 'aim') return
    this.playShot(shot)
  }

  setInteraction(enabled) {
    if (!enabled && this.interactionEnabled) {
      this.endPull(null, true)
      this.cancelSpace(true)
    } else if (enabled && !this.interactionEnabled) {
      this.setPower(this.playerPower ?? (this.state?.breakShot ? MODES[this.state.mode].breakPower : 0.45), false)
      this.setSpin(this.playerSpin, false)
    }
    this.interactionEnabled = enabled
  }

  setOverlayOpen(open) {
    this.overlayOpen = open
    if (open) {
      this.endPull(null, true)
      this.cancelSpace(true)
    }
  }

  setGuide(show) {
    this.showGuide = show
  }

  getAimState() {
    const cue = this.state?.balls[0]
    return {
      angle: this.angle,
      power: this.power,
      spin: { x: this.spin.x, y: this.spin.y },
      view: this.view,
      orbit: {
        yaw: this.orbitYaw,
        pitch: this.orbitPitch,
        zoom: this.orbitZoom,
        camH: this.camH,
        camD: this.camD,
      },
      cue: cue ? { x: cue.x, y: cue.y } : null,
      charging: !!(this.pull || this.space),
    }
  }

  applyRemoteAim(aim) {
    if (!aim || !this.state) return
    if (Number.isFinite(aim.angle)) this.angle = aim.angle
    if (Number.isFinite(aim.power)) this.setPower(aim.power, false)
    if (
      aim.spin &&
      Number.isFinite(aim.spin.x) &&
      Number.isFinite(aim.spin.y)
    )
      this.setSpin(aim.spin, false)
    if (aim.orbit) {
      if (Number.isFinite(aim.orbit.yaw)) this.orbitYaw = aim.orbit.yaw
      if (Number.isFinite(aim.orbit.pitch))
        this.orbitPitch = clamp(aim.orbit.pitch, 0.38, 1.38)
      if (Number.isFinite(aim.orbit.zoom))
        this.orbitZoom = clamp(aim.orbit.zoom, 0.72, 1.6)
      if (Number.isFinite(aim.orbit.camH))
        this.camH = clamp(aim.orbit.camH, 100, 850)
      if (Number.isFinite(aim.orbit.camD))
        this.camD = clamp(aim.orbit.camD, 220, 1200)
    }
    if (
      aim.view &&
      ['top', 'orbit', 'fp'].includes(aim.view) &&
      aim.view !== this.view
    )
      this.setView(aim.view)
    if (aim.cue && this.state.inHand) {
      const cue = this.state.balls[0]
      if (Number.isFinite(aim.cue.x) && Number.isFinite(aim.cue.y)) {
        cue.x = aim.cue.x
        cue.y = aim.cue.y
      }
    }
    if (typeof aim.charging === 'boolean') this.onCharge?.(aim.charging)
  }

  dispose() {
    this.disposed = true
    window.removeEventListener('resize', this.resizeBound)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.resizeObserver?.disconnect()
    this.clearBalls()
    if (this.tg) this.disposeGroup(this.tg)
    if (this.sg) this.sg.dispose()
    if (this.tableStage) this.disposeGroup(this.tableStage)
    if (this.aimGroup) this.disposeGroup(this.aimGroup)
    this.tableMapTextures?.forEach((map) => map.dispose())
    this.sun?.shadow.dispose()
    this.tableEnvironment?.dispose()
    this.renderer?.dispose()
  }
}

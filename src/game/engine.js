import * as THREE from 'three'
import { COL, DT, MAX_SIM_STEPS, RAIL, SC, clamp } from './constants.js'
import { getGeometry, toWorldX, toWorldZ } from './geometry.js'
import { moving, step } from './physics.js'
import { buildAimGuide } from './guide.js'
import { launchShot } from './match.js'
import * as audio from './audio.js'

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z)

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
    this.orbitYaw = 0.22
    this.orbitPitch = 0.91
    this.orbitZoom = 1
    this.camH = 270
    this.camD = 560
    this.cueTh = 0.07
    this.cameraReady = false
    this.showGuide = true
    this.power = 0.45
    this.spin = { x: 0, y: 0 }
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
    rd.setClearColor(0x101916, 0)
    rd.shadowMap.enabled = false
    rd.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = null
    this.cam = new THREE.PerspectiveCamera(50, 1, 10, 12000)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62))
    const sun = new THREE.DirectionalLight(0xffffff, 0.75)
    sun.castShadow = false
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    this.scene.add(sun)
    this.sun = sun
    const lamp = new THREE.PointLight(0xfff0d8, 0.35)
    lamp.position.set(0, 1500, 0)
    this.scene.add(lamp)

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

    this.aimGroup = new THREE.Group()
    const aimMaterial = (c) =>
      new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.75,
      })
    const cyl = (c) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1, 6), aimMaterial(c))
      this.aimGroup.add(m)
      return m
    }
    this.lineA = cyl(0xffffff)
    this.lineB = cyl(0xffe38a)
    this.lineC = cyl(0xffffff)
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.28,
      }),
    )
    this.aimGroup.add(this.ghost)

    const dashedLine = (color) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]),
        new THREE.LineDashedMaterial({
          color,
          dashSize: 22,
          gapSize: 14,
          transparent: true,
          opacity: 0.9,
        }),
      )
      line.visible = false
      this.aimGroup.add(line)
      return line
    }
    this.bankCueLine = dashedLine(0x8fd6ff)
    this.bankObjectLine = dashedLine(0xffd479)

    const pocketRing = new THREE.RingGeometry(0.72, 1, 36)
    const pocketMark = (color) => {
      const mark = new THREE.Mesh(
        pocketRing,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
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
      new THREE.MeshPhongMaterial({ color: c, shininess: s || 10 })
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
    else {
      x.fillStyle = '#c22'
      for (const u of [0, 128, 256, 384, 512]) {
        x.beginPath()
        x.arc(u, 128, 11, 0, 7)
        x.fill()
      }
    }
    return new THREE.CanvasTexture(c)
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
      if (m.map) m.map.dispose()
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
    const geo = this.geo
    const { W, H, RAIL: rail } = { ...geo, RAIL }
    const hw = W / 2
    const hh = H / 2
    const tx = (x) => toWorldX(geo, x)
    const tz = (y) => toWorldZ(geo, y)
    if (this.tg) {
      this.scene.remove(this.tg)
      this.disposeGroup(this.tg)
    }
    this.tg = new THREE.Group()
    this.scene.add(this.tg)
    const tg = this.tg

    const feltShape = new THREE.Shape()
    feltShape.moveTo(-hw - rail, -hh - rail)
    feltShape.lineTo(hw + rail, -hh - rail)
    feltShape.lineTo(hw + rail, hh + rail)
    feltShape.lineTo(-hw - rail, hh + rail)
    feltShape.closePath()
    for (const q of geo.PR) {
      const hole = new THREE.Path()
      hole.absarc(q[0] - hw, q[1] - hh, q[2] * 0.85, 0, Math.PI * 2, true)
      feltShape.holes.push(hole)
    }
    const fabric = document.createElement('canvas')
    fabric.width = fabric.height = 256
    const fabricCtx = fabric.getContext('2d')
    const pixels = fabricCtx.createImageData(256, 256)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = Math.random() * 13
      pixels.data[i] = 31 + n
      pixels.data[i + 1] = 107 + n
      pixels.data[i + 2] = 68 + n
      pixels.data[i + 3] = 255
    }
    fabricCtx.putImageData(pixels, 0, 0)
    const fabricMap = new THREE.CanvasTexture(fabric)
    fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping
    fabricMap.repeat.set(1 / 380, 1 / 380)
    fabricMap.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    const felt = new THREE.Mesh(
      new THREE.ShapeGeometry(feltShape, 32),
      new THREE.MeshLambertMaterial({ map: fabricMap }),
    )
    felt.rotation.x = -Math.PI / 2
    felt.receiveShadow = false
    tg.add(felt)

    const cushionMat = new THREE.MeshPhongMaterial({ color: 0x0d5a30, shininess: 5 })
    const h = 40
    const t = 50
    const cu = (pts) => {
      const sh = new THREE.Shape(
        pts.map((q) => new THREE.Vector2(q[0] - hw, q[1] - hh)),
      )
      const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false })
      g.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(g, cushionMat)
      m.castShadow = m.receiveShadow = false
      tg.add(m)
    }
    const fc = Math.max(
      0,
      Math.min(t, geo.gC - Math.sqrt(Math.max(0, (geo.PR[0][2] * 0.85 + 3) ** 2 - t * t))),
    )
    const fd = Math.max(
      0,
      Math.min(
        t,
        geo.gS - Math.sqrt(Math.max(0, (geo.PR[1][2] * 0.85 + 3) ** 2 - (t - geo.py) ** 2)),
      ),
    )
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
    hr(geo.gC, hw - geo.gS, 0, -1, fc, fd)
    hr(hw + geo.gS, W - geo.gC, 0, -1, fd, fc)
    hr(geo.gC, hw - geo.gS, H, 1, fc, fd)
    hr(hw + geo.gS, W - geo.gC, H, 1, fd, fc)
    vr(geo.gC, H - geo.gC, 0, -1, fc, fc)
    vr(geo.gC, H - geo.gC, W, 1, fc, fc)

    const frameShape = new THREE.Shape()
    frameShape.moveTo(-hw - rail, -hh - rail)
    frameShape.lineTo(hw + rail, -hh - rail)
    frameShape.lineTo(hw + rail, hh + rail)
    frameShape.lineTo(-hw - rail, hh + rail)
    frameShape.closePath()
    const rcn = geo.PR[0][2] * 0.85 + 7
    const rsd = geo.PR[1][2] * 0.85 + 7
    const ps = geo.py
    const dc = Math.sqrt(rcn * rcn - t * t)
    const dxs = Math.sqrt(rsd * rsd - (t - ps) * (t - ps))
    const path = new THREE.Path()
    const arc = (cx, cy, r, a, b) => {
      const a0 = Math.atan2(a[1] - cy, a[0] - cx)
      let a1 = Math.atan2(b[1] - cy, b[0] - cx)
      if (a1 < a0) a1 += Math.PI * 2
      path.absarc(cx, cy, r, a0, a1, false)
    }
    const Bbl = [-hw + dc, -hh - t]
    const Bbr = [hw - dc, -hh - t]
    const Abr = [hw + t, -hh + dc]
    const Atr = [hw + t, hh - dc]
    const Btr = [hw - dc, hh + t]
    const Btl = [-hw + dc, hh + t]
    const Atl = [-hw - t, hh - dc]
    const Abl = [-hw - t, -hh + dc]
    path.moveTo(Bbl[0], Bbl[1])
    path.lineTo(-dxs, -hh - t)
    arc(0, -hh - ps, rsd, [-dxs, -hh - t], [dxs, -hh - t])
    path.lineTo(Bbr[0], Bbr[1])
    arc(hw, -hh, rcn, Bbr, Abr)
    path.lineTo(Atr[0], Atr[1])
    arc(hw, hh, rcn, Atr, Btr)
    path.lineTo(dxs, hh + t)
    arc(0, hh + ps, rsd, [dxs, hh + t], [-dxs, hh + t])
    path.lineTo(Btl[0], Btl[1])
    arc(-hw, hh, rcn, Btl, Atl)
    path.lineTo(Abl[0], Abl[1])
    arc(-hw, -hh, rcn, Abl, Bbl)
    frameShape.holes.push(path)
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
      depth: 60,
      bevelEnabled: false,
    })
    frameGeo.rotateX(-Math.PI / 2)
    const frame = new THREE.Mesh(
      frameGeo,
      new THREE.MeshPhongMaterial({ color: 0x493326, shininess: 50 }),
    )
    frame.castShadow = frame.receiveShadow = false
    tg.add(frame)
    const apronGeo = new THREE.ExtrudeGeometry(frameShape, {
      depth: 160,
      bevelEnabled: false,
    })
    apronGeo.rotateX(-Math.PI / 2)
    const apron = new THREE.Mesh(
      apronGeo,
      new THREE.MeshPhongMaterial({ color: 0x251d16, shininess: 25 }),
    )
    apron.position.y = -160
    apron.castShadow = false
    tg.add(apron)

    for (const x of [W / 8, W / 4, (3 * W) / 8, (5 * W) / 8, (3 * W) / 4, (7 * W) / 8])
      for (const y of [-80, H + 80]) {
        const sight = new THREE.Mesh(
          new THREE.CircleGeometry(5, 4),
          new THREE.MeshPhongMaterial({ color: 0xc7ba93, shininess: 45 }),
        )
        sight.rotation.x = -Math.PI / 2
        sight.rotation.z = Math.PI / 4
        sight.position.set(tx(x), 60.6, tz(y))
        tg.add(sight)
      }
    for (const y of [H / 4, H / 2, (3 * H) / 4])
      for (const x of [-80, W + 80]) {
        const sight = new THREE.Mesh(
          new THREE.CircleGeometry(5, 4),
          new THREE.MeshPhongMaterial({ color: 0xc7ba93, shininess: 45 }),
        )
        sight.rotation.x = -Math.PI / 2
        sight.rotation.z = Math.PI / 4
        sight.position.set(tx(x), 60.6, tz(y))
        tg.add(sight)
      }

    for (const q of geo.PR) {
      const pr = q[2] * 0.85
      const pit = new THREE.Mesh(
        new THREE.CylinderGeometry(pr, pr * 0.72, 230, 48, 1, true),
        new THREE.MeshPhongMaterial({
          color: 0x11120f,
          side: THREE.BackSide,
          shininess: 3,
        }),
      )
      pit.position.set(tx(q[0]), -115, tz(q[1]))
      tg.add(pit)
      const bottom = new THREE.Mesh(
        new THREE.CircleGeometry(pr * 0.74, 40),
        new THREE.MeshBasicMaterial({ color: 0x030604 }),
      )
      bottom.rotation.x = -Math.PI / 2
      bottom.position.set(tx(q[0]), -230, tz(q[1]))
      tg.add(bottom)
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(pr + 2.5, 3, 8, 48),
        new THREE.MeshPhongMaterial({ color: 0x29291e, shininess: 15 }),
      )
      lip.rotation.x = -Math.PI / 2
      lip.position.set(tx(q[0]), 1, tz(q[1]))
      tg.add(lip)
      const leather = new THREE.Mesh(
        new THREE.RingGeometry(pr + 5, pr + 10, 48),
        new THREE.MeshPhongMaterial({ color: 0x63533a, shininess: 12 }),
      )
      leather.rotation.x = -Math.PI / 2
      leather.position.set(tx(q[0]), 0.8, tz(q[1]))
      tg.add(leather)
    }

    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
    })
    const ln = (pts) =>
      tg.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            pts.map((p) => V3(tx(p[0]), 0.7, tz(p[1]))),
          ),
          lineMat,
        ),
      )
    if (geo.mode === 'pool') ln([[W / 4, 0], [W / 4, H]])
    else {
      ln([[737, 0], [737, H]])
      const arcPoints = []
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / 24
        arcPoints.push([737 + 292 * Math.cos(a), H / 2 + 292 * Math.sin(a)])
      }
      ln(arcPoints)
    }

    Object.assign(this.sun.shadow.camera, {
      left: -W * 0.6,
      right: W * 0.6,
      top: H * 0.8,
      bottom: -H * 0.8,
      near: 100,
      far: 5000,
    })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.sun.position.set(-W * 0.2, 2200, H * 0.3)
  }

  createBallMesh(n) {
    const geo = this.geo
    const material =
      geo.mode === 'pool' || n === 0
        ? new THREE.MeshPhongMaterial({
            map: this.ballTexture(n),
            shininess: 110,
            specular: 0x555555,
          })
        : new THREE.MeshPhongMaterial({
            color: n <= 15 ? 0xc0161b : SC[n - 16],
            shininess: 110,
            specular: 0x555555,
          })
    const mesh = new THREE.Mesh(this.sg, material)
    mesh.castShadow = false
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

  loadMatch(state) {
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
    this.acc = 0
    this.power = 0.45
    this.spin = { x: 0, y: 0 }
    this.angle = 0
    this.orbitZoom = 1
    this.camH = 270
    this.camD = 560
    this.cameraReady = false
    this.resize()
    audio.rollSound(0)
    this.emitPower()
  }

  applyState(state) {
    if (!this.state || state.mode !== this.state.mode || state.balls.length !== this.state.balls.length) {
      this.loadMatch(state)
      return
    }
    this.state = state
    this.animating = false
    this.acc = 0
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
    this.orbitYaw = 0.22
    this.orbitPitch = 0.91
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
      for (const x of [-W / 2 - RAIL - 40, W / 2 + RAIL + 40])
        for (const z of [-H / 2 - RAIL - 40, H / 2 + RAIL + 40])
          for (const y of [-190, 65]) {
            const p = V3(x, y, z)
            const depth = p.dot(direction)
            distance = Math.max(
              distance,
              depth + Math.abs(p.dot(right)) / (tf * this.cam.aspect),
              depth + Math.abs(p.dot(up)) / tf,
            )
          }
      desired.up.set(0, 1, 0)
      desired.position.copy(direction).multiplyScalar(distance * 1.15 * this.orbitZoom)
      this.cameraTarget.set(0, -15, 0)
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
      } else if (ball.st < 0.5 && ball.q) {
        ball.st = Math.min(0.5, ball.st + (this.overlayOpen ? 0 : dt))
        const k = ball.st / 0.5
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
    const dragging = this.drag && state.phase === 'aim'
    const showCue = state.phase === 'aim' && cue.on && !dragging
    this.aimGroup.visible =
      this.showGuide && state.phase === 'aim' && cue.on && !dragging
    this.cueGroup.visible = showCue
    if (showCue) {
      const dx = Math.cos(this.angle)
      const dy = Math.sin(this.angle)
      const P = (x, y) => V3(tx(x), R, tz(y))
      if (state.phase === 'aim') {
        const guide = buildAimGuide(geo, state.balls, this.angle)
        const gx = guide.ghost.x
        const gy = guide.ghost.y
        const g = P(gx, gy)
        this.segment(this.lineA, P(cue.x, cue.y), g)
        this.ghost.position.copy(g)
        this.ghost.scale.setScalar(R)
        if (guide.hitBall && guide.object && guide.deflect) {
          const h = guide.hitBall
          this.segment(
            this.lineB,
            P(h.x, h.y),
            P(guide.object.to.x, guide.object.to.y),
          )
          this.segment(
            this.lineC,
            g,
            P(gx + guide.deflect.x * 220, gy + guide.deflect.y * 220),
          )
        } else this.lineB.visible = this.lineC.visible = false
        this.setGuideLine(this.bankCueLine, guide.cueBank)
        this.setGuideLine(this.bankObjectLine, guide.objectBank)
        this.setPocketMark(this.cuePocketMark, guide.cueBank)
        this.setPocketMark(this.objectPocketMark, guide.objectBank)
      }
      const strike = this.strikeProgress
      const gap = R + 3 + (11 + this.power * 260) * (1 - strike * strike)
      const th = this.cueTilt(cue, dx, dy)
      const axis = V3(dx * Math.cos(th), -Math.sin(th), -dy * Math.cos(th))
      this.cueGroup.position.set(tx(cue.x), R, tz(cue.y)).addScaledVector(axis, -gap)
      this.cueGroup.quaternion.setFromUnitVectors(Y_AXIS, axis)
      this.cueTh = th
    }

    this.updCam(dt)
    this.renderer.render(this.scene, this.cam)
  }

  segment(mesh, a, b) {
    const d = b.clone().sub(a)
    const length = d.length()
    mesh.visible = length > 1
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.scale.set(1, length || 1, 1)
    if (length > 1) mesh.quaternion.setFromUnitVectors(Y_AXIS, d.normalize())
  }

  setGuideLine(line, bank) {
    if (!bank) {
      line.visible = false
      return
    }
    const y = this.geo.R + 0.6
    line.geometry.setFromPoints([
      V3(
        toWorldX(this.geo, bank.from.x),
        y,
        toWorldZ(this.geo, bank.from.y),
      ),
      V3(toWorldX(this.geo, bank.to.x), y, toWorldZ(this.geo, bank.to.y)),
    ])
    line.computeLineDistances()
    line.visible = true
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
      while (this.acc >= DT) {
        step(this.state)
        this.acc -= DT
        this.simTime += DT
        this.animSteps++
      }
      const elapsed = this.simTime - t0
      let maxSpeed = 0
      for (const ball of this.state.balls) {
        if (!ball.on) continue
        this.spinBall(ball, elapsed)
        maxSpeed = Math.max(maxSpeed, Math.hypot(ball.vx, ball.vy))
      }
      this.drainEvents()
      audio.rollSound(maxSpeed)
      if (!moving(this.state.balls) || this.animSteps >= MAX_SIM_STEPS) {
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
        this.rotateAim((e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 0.0003 : 0.0012))
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
      if (p && this.state.inHand && this.geo && this.canPlaceCue(p, cue)) {
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

  canPlaceCue(p, cue) {
    const { R, W, H, PR } = this.geo
    if (this.state.mode === 'snk') {
      if (p.x > 737 || Math.hypot(p.x - 737, p.y - H / 2) > 292) return false
    } else if (this.state.breakShot && p.x > W / 4) return false
    if (p.x < R || p.x > W - R || p.y < R || p.y > H - R) return false
    if (PR.some((q) => Math.hypot(p.x - q[0], p.y - q[1]) < q[2] * 0.85 + R * 0.2))
      return false
    return this.state.balls.every(
      (b) => b === cue || !b.on || Math.hypot(b.x - p.x, b.y - p.y) >= 2 * R + 0.5,
    )
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
    this.onPower?.(this.power)
  }

  setPower(value) {
    this.power = clamp(value, 0.01, 1)
    this.emitPower()
  }

  setSpin(spin) {
    this.spin = {
      x: clamp(spin.x, -0.65, 0.65),
      y: clamp(spin.y, -0.65, 0.65),
    }
    this.onSpin?.(this.spin)
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
    this.setPower(this.pull.d < 8 ? 0.01 : Math.min(1, 0.02 + (this.pull.d / full) * 0.98))
  }

  endPull(e, cancel) {
    if (!this.pull || (e && e.pointerId !== this.pull.id)) return
    const ok = !cancel && this.pull.d >= 14 && this.state?.phase === 'aim'
    if (!ok) this.setPower(this.pull.p0)
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
    if (reset) this.setPower(s.p0)
    this.onCharge?.(false)
  }

  releaseSpace(cancel) {
    if (!this.space) return
    const s = this.space
    this.space = null
    if (cancel || s.t <= 0.22) this.setPower(s.p0)
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
      this.setPower(0.03 + 0.97 * (u < 1 ? u : 2 - u))
    }
  }

  shoot() {
    if (!this.acceptsInput() || !this.state || this.striking) return
    audio.ensureAudio()
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
    if (Number.isFinite(aim.power)) {
      this.power = clamp(aim.power, 0.01, 1)
      this.onPower?.(this.power)
    }
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
    this.renderer?.dispose()
  }
}

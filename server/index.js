import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createMatch, offerStalemate, publicState, resolveBreakChoice, resolveFrameChoice, simulateShot } from '../src/game/match.js'
import {
  offerConcession,
  canConcedeFrame,
} from '../src/game/rules.js'
import { canPlaceCue } from '../src/game/physics.js'
import { clamp } from '../src/game/constants.js'
import {
  advanceSeries,
  createSeries,
  normalizeBestOf,
  publicSeries,
  recordFrameResult,
} from '../src/game/series.js'

const PORT = Number(process.env.WS_PORT || 3210)
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = join(ROOT, 'dist')
const MAX_ROOMS = 500
const MAX_MESSAGE_BYTES = 8 * 1024

const rooms = new Map()
const sockets = new Set()

/* ---------- 静态资源 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function serveStatic(req, res) {
  if (!existsSync(DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('前端尚未构建：请先运行 npm run build，或用 npm run dev 启动开发服务器。')
    return
  }
  const url = new URL(req.url || '/', 'http://localhost')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad request')
    return
  }
  if (pathname === '/') pathname = '/index.html'
  const target = normalize(join(DIST, pathname))
  if (target !== DIST && !target.startsWith(DIST + sep)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  let file = target
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    if (extname(pathname)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    file = join(DIST, 'index.html')
  }
  try {
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': file.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  serveStatic(req, res)
})

/* ---------- 联机房间 ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES })

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function roomPayload(room, seat) {
  return {
    type: 'room',
    code: room.code,
    mode: room.mode,
    seat,
    hostSeat: 0,
    started: room.started,
    guide: room.guide,
    visibility: room.visibility,
    match: publicSeries(room.match),
    players: room.names.map((name, index) => ({
      seat: index,
      name: name || null,
      connected: !!room.clients[index],
    })),
    rematch: [...room.rematch],
  }
}

function broadcast(room, message) {
  room.clients.forEach((client) => {
    if (client) send(client, message)
  })
}

function broadcastRoom(room) {
  room.clients.forEach((client, seat) => {
    if (client) send(client, roomPayload(room, seat))
  })
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = ''
    for (let i = 0; i < 5; i++)
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (!rooms.has(code)) return code
  }
  return null
}

function cleanName(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 12) || '球友'
}

function cancelPending(ws) {
  const pending = ws.pending
  if (!pending) return
  ws.pending = null
  const room = rooms.get(pending.code)
  if (!room) return
  if (room.requests.delete(pending.id)) {
    send(room.clients[0], { type: 'join-request-cancelled', id: pending.id })
  }
}

function denyPending(room, message) {
  for (const [id, request] of room.requests) {
    send(request.ws, { type: 'join-denied', message })
    send(room.clients[0], { type: 'join-request-cancelled', id })
    if (request.ws.pending?.id === id) request.ws.pending = null
  }
  room.requests.clear()
}

function makeRequestId() {
  return Math.random().toString(36).slice(2, 10)
}

function publicRoomList() {
  const list = []
  for (const room of rooms.values()) {
    if (room.visibility !== 'public' || room.started) continue
    if (!room.clients[0] || room.clients[1]) continue
    list.push({
      code: room.code,
      mode: room.mode,
      host: room.names[0],
      guide: room.guide,
      bestOf: room.match.bestOf,
      players: 1,
    })
    if (list.length >= 50) break
  }
  return list
}

function recordMatchResult(room) {
  if (!room.started || !room.state || room.state.phase !== 'over') return false
  const changed = recordFrameResult(room.match, room.state.winner)
  if (changed) broadcastRoom(room)
  return changed
}

function leaveRoom(ws, notify = true) {
  cancelPending(ws)
  const room = ws.room
  if (!room) return
  const seat = ws.seat
  if (room.clients[seat] === ws) room.clients[seat] = null
  ws.room = null
  ws.seat = null
  if (seat === 0) {
    // 房主离开即关闭房间，避免留下无法审批的公开房。
    const other = room.clients[1]
    if (other) {
      if (!room.match.over)
        send(other, { type: 'room-closed', message: '房主已离开，房间已关闭。' })
      other.room = null
      other.seat = null
    }
    denyPending(room, '房主已离开，房间已关闭。')
    room.clients = [null, null]
    rooms.delete(room.code)
    return
  }
  const other = room.clients[0]
  if (notify && !room.match.over) {
    if (other) send(other, { type: 'peer', event: 'left' })
    broadcastRoom(room)
  }
  if (!room.clients[0] && !room.clients[1]) rooms.delete(room.code)
}

function newMatch(room) {
  const seed = (Math.random() * 2 ** 32) >>> 0
  room.state = createMatch(room.mode, seed, room.names)
  room.state.breakMisses = [
    ...(room.match?.breakMisses || [0, 0]),
  ]
  // 每局轮换开球方：第 1 局房主/玩家1，第 2 局对手，依此类推。
  if ((room.match?.frame || 1) % 2 === 0) {
    room.state.turn = room.state.opener = 1
    room.state.message = `${room.state.names?.[1] || '玩家2'} 开球 · 拖动白球摆位，轻点台面瞄准`
  }
  room.started = true
  room.rematch = [false, false]
  room.match.recorded = false
  return publicState(room.state)
}

function seatGuest(ws, room, name) {
  const seat = room.clients[0] ? 1 : 0
  room.clients[seat] = ws
  room.names[seat] = name
  ws.room = room
  ws.seat = seat
  broadcastRoom(room)
  room.clients.forEach((client, index) => {
    if (client && index !== seat)
      send(client, { type: 'peer', event: 'joined', name: room.names[seat] })
  })
}

function sanitizeShot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const angle = Number(raw.angle)
  const power = Number(raw.power)
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return null
  const spin = {
    x: clamp(Number(raw.spin?.x) || 0, -0.65, 0.65),
    y: clamp(Number(raw.spin?.y) || 0, -0.65, 0.65),
  }
  let cue = null
  if (raw.cue && Number.isFinite(Number(raw.cue.x)) && Number.isFinite(Number(raw.cue.y)))
    cue = { x: Number(raw.cue.x), y: Number(raw.cue.y) }
  return {
    angle: ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    power: clamp(power, 0, 1),
    spin,
    cue,
  }
}

function sanitizeAim(raw, geo) {
  if (!raw || typeof raw !== 'object') return null
  const angle = Number(raw.angle)
  const power = Number(raw.power)
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return null
  const finite = (value, min, max, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) ? clamp(number, min, max) : fallback
  }
  const view = ['top', 'orbit', 'fp'].includes(raw.view) ? raw.view : 'orbit'
  const orbit = raw.orbit && typeof raw.orbit === 'object'
    ? {
        yaw: finite(raw.orbit.yaw, -Math.PI * 8, Math.PI * 8, 0),
        pitch: finite(raw.orbit.pitch, 0.38, 1.38, 0.91),
        zoom: finite(raw.orbit.zoom, 0.72, 1.6, 1),
        camH: finite(raw.orbit.camH, 100, 850, 270),
        camD: finite(raw.orbit.camD, 220, 1200, 560),
      }
    : null
  let cue = null
  if (raw.cue && Number.isFinite(Number(raw.cue.x)) && Number.isFinite(Number(raw.cue.y)))
    cue = {
      x: clamp(Number(raw.cue.x), 0, geo?.W || 4000),
      y: clamp(Number(raw.cue.y), 0, geo?.H || 2000),
    }
  return {
    angle: ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    power: clamp(power, 0, 1),
    spin: {
      x: finite(raw.spin?.x, -0.65, 0.65, 0),
      y: finite(raw.spin?.y, -0.65, 0.65, 0),
    },
    view,
    orbit,
    cue,
    charging: raw.charging === true,
  }
}

function handleMessage(ws, message) {
  const type = message?.type
  if (type === 'ping') {
    send(ws, { type: 'pong', t: message.t })
    return
  }

  if (type === 'create') {
    leaveRoom(ws)
    if (rooms.size >= MAX_ROOMS) {
      send(ws, { type: 'error', message: '房间已满，请稍后再试。' })
      return
    }
    const mode =
      message.mode === 'snk'
        ? 'snk'
        : message.mode === 'nine'
          ? 'nine'
          : 'pool'
    const visibility = message.visibility === 'private' ? 'private' : 'public'
    const bestOf = normalizeBestOf(message.bestOf)
    const code = makeCode()
    if (!code) {
      send(ws, { type: 'error', message: '无法创建房间，请稍后再试。' })
      return
    }
    const room = {
      code,
      mode,
      visibility,
      bestOf,
      names: [cleanName(message.name), null],
      clients: [ws, null],
      state: null,
      started: false,
      guide: message.guide !== false,
      rematch: [false, false],
      match: createSeries(bestOf),
      requests: new Map(),
    }
    rooms.set(code, room)
    ws.room = room
    ws.seat = 0
    send(ws, roomPayload(room, 0))
    return
  }

  if (type === 'join') {
    const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    let room = rooms.get(code)
    if (!room || !room.clients[0]) {
      send(ws, { type: 'error', message: '没有找到这个房间，请检查房间码。' })
      return
    }
    if (room.clients[1]) {
      send(ws, { type: 'error', message: '房间已满。' })
      return
    }
    if (room.started) {
      send(ws, { type: 'error', message: '这局已经开始了，换一个房间吧。' })
      return
    }
    leaveRoom(ws)
    room = rooms.get(code)
    if (!room || !room.clients[0] || room.clients[1] || room.started) {
      send(ws, { type: 'error', message: '房间已关闭或已满。' })
      return
    }
    if (room.visibility === 'public') {
      if (room.requests.size >= 5) {
        send(ws, { type: 'error', message: '房主正在处理其他申请，请稍后再试。' })
        return
      }
      const id = makeRequestId()
      const name = cleanName(message.name)
      room.requests.set(id, { id, ws, name })
      ws.pending = { code: room.code, id }
      send(ws, { type: 'join-pending', code: room.code })
      send(room.clients[0], { type: 'join-request', id, name, code: room.code })
      return
    }
    seatGuest(ws, room, cleanName(message.name))
    return
  }

  if (type === 'rooms') {
    send(ws, { type: 'rooms', rooms: publicRoomList() })
    return
  }

  if (type === 'cancel-join') {
    cancelPending(ws)
    return
  }

  if (type === 'leave') {
    leaveRoom(ws)
    return
  }

  const room = ws.room
  if (!room) {
    send(ws, { type: 'error', message: '还没有加入房间。' })
    return
  }

  if (type === 'respond') {
    if (ws.seat !== 0) {
      send(ws, { type: 'error', message: '只有房主可以处理加入申请。' })
      return
    }
    const id = String(message.id || '')
    const request = room.requests.get(id)
    if (!request) return
    room.requests.delete(id)
    send(ws, { type: 'join-request-resolved', id })
    if (!message.accept) {
      send(request.ws, { type: 'join-denied', message: '房主拒绝了你的加入申请。' })
      if (request.ws.pending?.id === id) request.ws.pending = null
      return
    }
    if (
      room.started ||
      !room.clients[0] ||
      room.clients[1] ||
      request.ws.readyState !== 1
    ) {
      send(request.ws, { type: 'join-denied', message: '房间已满或对局已经开始。' })
      if (request.ws.pending?.id === id) request.ws.pending = null
      return
    }
    const guest = request.ws
    guest.pending = null
    seatGuest(guest, room, request.name)
    denyPending(room, '房间已满。')
    return
  }

  if (type === 'aim') {
    if (!room.started || !room.state || room.state.phase !== 'aim') return
    if (ws.seat !== room.state.turn) return
    const other = room.clients[1 - ws.seat]
    if (!other) return
    const aim = sanitizeAim(message.aim, room.state.geo)
    if (aim) {
      if (aim.cue && (!room.state.inHand || !canPlaceCue(room.state, aim.cue.x, aim.cue.y)))
        aim.cue = null
      send(other, { type: 'aim', seat: ws.seat, aim })
    }
    return
  }

  if (type === 'start') {
    if (ws.seat !== 0) {
      send(ws, { type: 'error', message: '只有房主可以开始对局。' })
      return
    }
    if (room.started) {
      send(ws, { type: 'error', message: '对局已经开始了。' })
      return
    }
    if (!room.clients[0] || !room.clients[1]) {
      send(ws, { type: 'error', message: '等待另一位玩家加入。' })
      return
    }
    denyPending(room, '房主已经开始对局。')
    room.match = createSeries(room.bestOf)
    const state = newMatch(room)
    broadcastRoom(room)
    broadcast(room, {
      type: 'start',
      state,
      guide: room.guide,
      match: publicSeries(room.match),
    })
    return
  }

  if (type === 'shot') {
    if (!room.started || !room.state) {
      send(ws, { type: 'error', message: '对局还没有开始。' })
      return
    }
    if (ws.seat !== room.state.turn) {
      send(ws, { type: 'error', message: '还没轮到你击球。' })
      return
    }
    if (room.state.phase !== 'aim') {
      send(ws, { type: 'error', message: '现在不能击球。' })
      return
    }
    const shot = sanitizeShot(message.shot)
    if (!shot) {
      send(ws, { type: 'error', message: '击球参数无效。' })
      return
    }
    if (room.state.inHand && shot.cue && !canPlaceCue(room.state, shot.cue.x, shot.cue.y)) {
      send(ws, { type: 'error', message: '白球必须摆在允许击球的空位上。' })
      send(ws, { type: 'state', state: publicState(room.state) })
      return
    }
    const working = structuredClone(room.state)
    working.geo = room.state.geo
    simulateShot(working, shot)
    room.state = working
    if (working.mode === 'pool')
      room.match.breakMisses = [...working.breakMisses]
    recordMatchResult(room)
    broadcast(room, {
      type: 'shot',
      seat: ws.seat,
      shot,
      state: publicState(working),
      match: publicSeries(room.match),
    })
    return
  }

  if (type === 'break-choice') {
    if (!room.started || !room.state) {
      send(ws, { type: 'error', message: '对局还没有开始。' })
      return
    }
    const choice = room.state.breakChoice
    if (room.state.phase !== 'choice' || !choice) {
      send(ws, { type: 'error', message: '现在没有需要处理的开球失机。' })
      return
    }
    if (ws.seat !== choice.seat) {
      send(ws, { type: 'error', message: '还没轮到你选择。' })
      return
    }
    const decision = message.decision === 'rerack' ? 'rerack' : 'accept'
    if (choice.kind === 'no-contact' && decision !== 'rerack') {
      send(ws, { type: 'error', message: '本杆未碰到球堆，请选择重新开球。' })
      return
    }
    let breakerSeat = null
    if (decision === 'rerack') {
      breakerSeat = Number(message.breakerSeat)
      if (breakerSeat !== choice.seat && breakerSeat !== choice.offender) {
        send(ws, { type: 'error', message: '重新开球方无效。' })
        return
      }
    }
    const working = structuredClone(room.state)
    working.geo = room.state.geo
    resolveBreakChoice(working, decision, breakerSeat)
    room.state = working
    room.match.breakMisses = [...working.breakMisses]
    if (decision === 'rerack') {
      broadcast(room, {
        type: 'start',
        state: publicState(working),
        guide: room.guide,
        match: publicSeries(room.match),
      })
    } else {
      broadcast(room, {
        type: 'state',
        state: publicState(working),
        match: publicSeries(room.match),
      })
    }
    recordMatchResult(room)
    return
  }

  if (type === 'choice') {
    if (!room.started || !room.state) {
      send(ws, { type: 'error', message: '对局还没有开始。' })
      return
    }
    const choice = room.state.sn?.choice
    if (room.state.phase !== 'choice' || !choice) {
      send(ws, { type: 'error', message: '现在没有需要处理的犯规选择。' })
      return
    }
    if (ws.seat !== choice.seat) {
      send(ws, { type: 'error', message: '还没轮到你选择。' })
      return
    }
    const decision =
      message.decision === 'replay'
        ? choice.miss
          ? 'replay'
          : 'again'
        : message.decision === 'again'
          ? 'again'
          : 'play'
    const freeBall = Number.isInteger(message.freeBall)
      ? message.freeBall
      : null
    if (decision === 'play' && choice.freeBall && freeBall != null) {
      const seqColor =
        room.state.sn.onRed || room.state.sn.finalColor
          ? null
          : 16 + room.state.sn.idx
      if (
        freeBall < 16 ||
        freeBall > 21 ||
        freeBall === seqColor ||
        !room.state.balls.some((ball) => ball.on && ball.n === freeBall)
      ) {
        send(ws, { type: 'error', message: '自由球选择无效。' })
        return
      }
    }
    const working = structuredClone(room.state)
    working.geo = room.state.geo
    room.state = resolveFrameChoice(working, decision, freeBall)
    recordMatchResult(room)
    broadcast(room, {
      type: 'state',
      state: publicState(room.state),
      match: publicSeries(room.match),
    })
    return
  }

  if (type === 'stalemate') {
    if (room.state?.phase !== 'aim' || ws.seat !== room.state.turn || room.state.breakShot) {
      send(ws, { type: 'error', message: '现在不能提出重摆。' })
      return
    }
    offerStalemate(room.state)
    broadcast(room, { type: 'state', state: publicState(room.state) })
    return
  }

  if (type === 'concede') {
    if (!room.started || !room.state) {
      send(ws, { type: 'error', message: '对局还没有开始。' })
      return
    }
    if (room.state.mode !== 'snk' || room.state.phase !== 'aim') {
      send(ws, { type: 'error', message: '现在不能认输。' })
      return
    }
    if (ws.seat !== room.state.turn) {
      send(ws, { type: 'error', message: '还没轮到你击球。' })
      return
    }
    if (!canConcedeFrame(room.state, ws.seat)) {
      send(ws, { type: 'error', message: '台面剩余分数足够，不能认输。' })
      return
    }
    const working = structuredClone(room.state)
    working.geo = room.state.geo
    offerConcession(working, ws.seat)
    room.state = working
    recordMatchResult(room)
    broadcast(room, {
      type: 'state',
      state: publicState(working),
      match: publicSeries(room.match),
    })
    return
  }

  if (type === 'rematch') {
    if (!room.started || room.state?.phase !== 'over') {
      send(ws, { type: 'error', message: '本局还没有结束。' })
      return
    }
    recordMatchResult(room)
    if (room.match.over) {
      send(ws, { type: 'error', message: '整场比赛已结束。' })
      return
    }
    room.rematch[ws.seat] = true
    broadcastRoom(room)
    if (room.rematch[0] && room.rematch[1] && advanceSeries(room.match)) {
      const state = newMatch(room)
      broadcastRoom(room)
      broadcast(room, {
        type: 'start',
        state,
        guide: room.guide,
        match: publicSeries(room.match),
      })
    }
    return
  }

  send(ws, { type: 'error', message: '未知的消息类型。' })
}

wss.on('connection', (ws) => {
  sockets.add(ws)
  ws.isAlive = true
  ws.rate = { window: Date.now(), count: 0 }
  ws.on('pong', () => {
    ws.isAlive = true
  })
  ws.on('message', (raw) => {
    const now = Date.now()
    if (now - ws.rate.window > 1000) ws.rate = { window: now, count: 0 }
    ws.rate.count++
    if (ws.rate.count > 40) return
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', message: '消息格式错误。' })
      return
    }
    try {
      handleMessage(ws, message)
    } catch (error) {
      console.error('message failed', error)
      send(ws, { type: 'error', message: '服务器处理失败，请重试。' })
    }
  })
  ws.on('close', () => {
    sockets.delete(ws)
    leaveRoom(ws)
  })
  ws.on('error', () => {})
})

setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    try {
      ws.ping()
    } catch (_) {}
  }
}, 30000).unref()

server.listen(PORT, () => {
  console.log(`台球联机服务已启动: http://localhost:${PORT}  (WebSocket /ws)`)
})

export { server, wss, rooms }

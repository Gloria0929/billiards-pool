import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { createMatch, publicState, simulateShot } from '../src/game/match.js'
import { clamp } from '../src/game/constants.js'

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

function leaveRoom(ws, notify = true) {
  const room = ws.room
  if (!room) return
  const seat = ws.seat
  if (room.clients[seat] === ws) room.clients[seat] = null
  ws.room = null
  ws.seat = null
  const other = room.clients[1 - seat]
  if (notify) {
    if (other) send(other, { type: 'peer', event: 'left' })
    broadcastRoom(room)
  }
  if (!room.clients[0] && !room.clients[1]) {
    rooms.delete(room.code)
  }
}

function newMatch(room) {
  const seed = (Math.random() * 2 ** 32) >>> 0
  room.state = createMatch(room.mode, seed, room.names)
  room.started = true
  room.rematch = [false, false]
  return publicState(room.state)
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
    const mode = message.mode === 'snk' ? 'snk' : 'pool'
    const code = makeCode()
    if (!code) {
      send(ws, { type: 'error', message: '无法创建房间，请稍后再试。' })
      return
    }
    const room = {
      code,
      mode,
      names: [cleanName(message.name), null],
      clients: [ws, null],
      state: null,
      started: false,
      guide: message.guide !== false,
      rematch: [false, false],
    }
    rooms.set(code, room)
    ws.room = room
    ws.seat = 0
    send(ws, roomPayload(room, 0))
    return
  }

  if (type === 'join') {
    const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    const room = rooms.get(code)
    if (!room) {
      send(ws, { type: 'error', message: '没有找到这个房间，请检查房间码。' })
      return
    }
    if (room.clients[0] && room.clients[1]) {
      send(ws, { type: 'error', message: '房间已满。' })
      return
    }
    if (room.started) {
      send(ws, { type: 'error', message: '这局已经开始了，换一个房间吧。' })
      return
    }
    leaveRoom(ws)
    const seat = room.clients[0] ? 1 : 0
    room.clients[seat] = ws
    room.names[seat] = cleanName(message.name)
    ws.room = room
    ws.seat = seat
    broadcastRoom(room)
    room.clients.forEach((client, index) => {
      if (client && index !== seat)
        send(client, { type: 'peer', event: 'joined', name: room.names[seat] })
    })
    return
  }

  const room = ws.room
  if (!room) {
    send(ws, { type: 'error', message: '还没有加入房间。' })
    return
  }

  if (type === 'aim') {
    if (!room.started || !room.state || room.state.phase !== 'aim') return
    if (ws.seat !== room.state.turn) return
    const other = room.clients[1 - ws.seat]
    if (!other) return
    const aim = sanitizeAim(message.aim, room.state.geo)
    if (aim) send(other, { type: 'aim', seat: ws.seat, aim })
    return
  }

  if (type === 'start') {
    if (ws.seat !== 0) {
      send(ws, { type: 'error', message: '只有房主可以开始对局。' })
      return
    }
    if (!room.clients[0] || !room.clients[1]) {
      send(ws, { type: 'error', message: '等待另一位玩家加入。' })
      return
    }
    const state = newMatch(room)
    broadcastRoom(room)
    broadcast(room, { type: 'start', state, guide: room.guide })
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
    const working = structuredClone(room.state)
    working.geo = room.state.geo
    simulateShot(working, shot)
    room.state = working
    broadcast(room, {
      type: 'shot',
      seat: ws.seat,
      shot,
      state: publicState(working),
    })
    return
  }

  if (type === 'rematch') {
    if (!room.started || room.state?.phase !== 'over') {
      send(ws, { type: 'error', message: '本局还没有结束。' })
      return
    }
    room.rematch[ws.seat] = true
    broadcastRoom(room)
    if (room.rematch[0] && room.rematch[1]) {
      const state = newMatch(room)
      broadcastRoom(room)
      broadcast(room, { type: 'start', state, guide: room.guide })
    }
    return
  }

  if (type === 'leave') {
    leaveRoom(ws)
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

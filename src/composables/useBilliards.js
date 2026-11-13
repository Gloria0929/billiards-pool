import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import { BilliardsEngine } from '../game/engine.js'
import { createMatch, hydrateState, snapshot } from '../game/match.js'
import { endShot } from '../game/rules.js'
import { MODES } from '../game/constants.js'
import * as audio from '../game/audio.js'
import { NetClient } from '../net/client.js'

const STORAGE_NAME = 'billiards-name'
const STORAGE_GUIDE = 'billiards-guide'

export function useBilliards() {
  const canvasRef = ref(null)
  let engine = null
  let state = null
  let net = null
  let pendingServer = null
  let preOnlineGuide = null
  let aimTimer = null
  let lastAimPayload = ''
  let lastAimTurn = null

  const ui = reactive({
    ready: false,
    webglError: false,
    selectedMode: 'pool',
    mode: 'pool',
    modeName: MODES.pool.name,
    phase: 'menu',
    turn: 0,
    groups: [null, null],
    scores: [0, 0],
    names: null,
    balls: [],
    message: '',
    winner: null,
    power: 0.45,
    charging: false,
    spin: { x: 0, y: 0 },
    view: 'orbit',
    showGuide: true,
    canShoot: false,
    modeLabel: '中式八球 · 本地双人',
    menu: {
      visible: true,
      kind: 'start',
      title: '选一张球桌，开局。',
      intro: '一杆的手感，一局的较量。选择你想玩的台球。',
    },
    online: {
      status: 'idle',
      code: '',
      seat: null,
      players: [],
      name: '',
      error: '',
      opponentLeft: false,
      waiting: false,
      rematch: [false, false],
      guide: true,
    },
    audio: { volume: 0.7, muted: false, unavailable: false },
    settingsOpen: false,
  })

  /* ---------- 初始化 ---------- */
  onMounted(() => {
    try {
      ui.online.name = localStorage.getItem(STORAGE_NAME) || ''
    } catch (_) {}
    try {
      ui.showGuide = localStorage.getItem(STORAGE_GUIDE) !== 'off'
    } catch (_) {}
    ui.online.guide = ui.showGuide

    engine = new BilliardsEngine(canvasRef.value)
    engine.overlayOpen = true
    engine.showGuide = ui.showGuide
    engine.onShoot = handleShoot
    engine.onRest = handleRest
    engine.onPower = (value) => {
      ui.power = value
    }
    engine.onCharge = (value) => {
      ui.charging = value
    }
    engine.onPhase = () => {
      syncUi()
    }
    engine.onView = (view) => {
      ui.view = view
    }
    engine.onSpin = (spin) => {
      ui.spin = { x: spin.x, y: spin.y }
    }
    engine.onError = () => {
      ui.webglError = true
    }
    audio.setAudioListener(() => {
      ui.audio = { ...audio.audioState() }
    })
    ui.audio = { ...audio.audioState() }

    const preview = createMatch('pool')
    state = preview
    engine.loadMatch(state)
    syncUi()

    net = new NetClient()
    bindNet(net)
    aimTimer = setInterval(publishAim, 60)
    document.addEventListener('keydown', onEscape)
    ui.ready = true
  })

  function onEscape(e) {
    if (e.key !== 'Escape') return
    if (ui.menu.visible && ui.menu.kind === 'paused') {
      e.preventDefault()
      resumeGame()
    }
  }

  onBeforeUnmount(() => {
    if (aimTimer) clearInterval(aimTimer)
    aimTimer = null
    document.removeEventListener('keydown', onEscape)
    if (ui.online.status !== 'idle') {
      net?.send({ type: 'leave' })
      net?.close()
    }
    engine?.dispose()
    engine = null
  })

  /* ---------- 状态同步 ---------- */
  function syncUi() {
    if (!state) return
    const snap = snapshot(state)
    ui.mode = snap.mode
    ui.modeName = snap.modeName
    ui.phase = snap.phase
    ui.turn = snap.turn
    ui.groups = snap.groups
    ui.scores = snap.scores
    ui.names = snap.names
    ui.balls = snap.balls
    ui.message = snap.message
    ui.winner = snap.winner
    const onlinePlaying = ui.online.status === 'playing'
    ui.modeLabel =
      ui.online.status === 'room' || onlinePlaying
        ? `${snap.modeName} · 房间 ${ui.online.code}`
        : `${snap.modeName} · 本地双人`
    const myTurn = !onlinePlaying || ui.online.seat === state.turn
    ui.canShoot =
      state.phase === 'aim' &&
      !ui.menu.visible &&
      myTurn &&
      !ui.online.waiting
    engine?.setInteraction(ui.canShoot)
  }

  function showMenu(kind, title, intro) {
    ui.menu.visible = true
    ui.menu.kind = kind
    ui.menu.title = title
    ui.menu.intro = intro
    engine?.setOverlayOpen(true)
    syncUi()
  }

  function closeMenu() {
    ui.menu.visible = false
    engine?.setOverlayOpen(false)
    syncUi()
  }

  function openOverlayForResult() {
    const online = ui.online.status === 'playing'
    showMenu(
      online ? 'online-over' : 'over',
      state.message || '本局结束',
      online ? '本局已结束，双方都选择再来一局即可重新开球。' : '本局已结束，选择玩法开始下一局。',
    )
  }

  /* ---------- 本地对局 ---------- */
  function selectMode(mode) {
    if (ui.online.status === 'room' || ui.online.status === 'playing') return
    ui.selectedMode = mode
  }

  function startLocal() {
    if (ui.online.status !== 'idle') leaveRoom(true)
    audio.ensureAudio()
    state = createMatch(ui.selectedMode)
    engine.loadMatch(state)
    audio.restoreMaster()
    closeMenu()
    syncUi()
    engine.setInteraction(true)
  }

  function openMenu() {
    if (ui.online.status === 'playing') return
    if (!state) return
    audio.silence()
    showMenu(
      'paused',
      '换一种玩法。',
      '当前对局已暂停。开始新局会重新摆球。',
    )
  }

  function resumeGame() {
    if (ui.menu.kind !== 'paused' && ui.menu.kind !== 'online-menu') return
    closeMenu()
    audio.restoreMaster()
  }

  /* ---------- 音效 / 辅助线 ---------- */
  function guideLocked() {
    return ui.online.status === 'room' || ui.online.status === 'playing'
  }

  function applyGuide(value, persist = true) {
    ui.showGuide = !!value
    engine?.setGuide(ui.showGuide)
    if (persist) {
      try {
        localStorage.setItem(STORAGE_GUIDE, ui.showGuide ? 'on' : 'off')
      } catch (_) {}
    }
  }

  function toggleGuide() {
    if (guideLocked()) return
    applyGuide(!ui.showGuide)
  }

  function setRoomGuide(value) {
    if (ui.online.status !== 'idle') return
    ui.online.guide = !!value
  }

  function toggleSettings() {
    ui.settingsOpen = !ui.settingsOpen
    if (ui.settingsOpen) audio.ensureAudio()
  }

  function closeSettings() {
    ui.settingsOpen = false
  }

  function setVolume(value) {
    audio.ensureAudio()
    audio.setVolume(value / 100)
    ui.audio = { ...audio.audioState() }
  }

  function toggleMute() {
    audio.ensureAudio()
    audio.toggleMuted()
    ui.audio = { ...audio.audioState() }
  }

  function previewSound() {
    audio.playPreview()
  }

  /* ---------- 引擎事件 ---------- */
  function handleShoot(shot) {
    if (ui.online.status === 'playing') {
      const sent = net.send({ type: 'shot', shot })
      if (!sent) return
      ui.online.waiting = true
      pendingServer = null
      syncUi()
    }
  }

  function handleRest() {
    if (ui.online.status === 'playing') {
      if (pendingServer) {
        applyServerState(pendingServer)
        pendingServer = null
      } else {
        ui.online.waiting = true
        syncUi()
      }
      return
    }
    endShot(state)
    syncUi()
    if (state.phase === 'over') openOverlayForResult()
  }

  function applyServerState(next) {
    state = hydrateState(next)
    ui.online.waiting = false
    pendingServer = null
    engine.applyState(state)
    syncUi()
    if (state.phase === 'over' && ui.online.status === 'playing') openOverlayForResult()
  }

  /* ---------- 联机 ---------- */
  function setName(value) {
    ui.online.name = value
    try {
      localStorage.setItem(STORAGE_NAME, value)
    } catch (_) {}
  }

  function ensureConnected() {
    if (ui.online.status === 'connecting') return Promise.resolve()
    ui.online.status = 'connecting'
    ui.online.error = ''
    return net.connect().catch(() => {
      ui.online.status = 'idle'
      throw new Error('connect failed')
    })
  }

  function createRoom() {
    ensureConnected()
      .then(() => {
        net.send({
          type: 'create',
          mode: ui.selectedMode,
          name: ui.online.name,
          guide: ui.online.guide,
        })
      })
      .catch(() => {})
  }

  function joinRoom(code) {
    const cleaned = String(code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6)
    if (cleaned.length < 4) {
      ui.online.error = '请输入 5 位房间码。'
      return
    }
    ensureConnected()
      .then(() => {
        net.send({ type: 'join', code: cleaned, name: ui.online.name })
      })
      .catch(() => {})
  }

  function startOnline() {
    if (ui.online.status !== 'room') return
    net.send({ type: 'start' })
  }

  function requestRematch() {
    if (ui.online.status !== 'playing') return
    net.send({ type: 'rematch' })
    if (ui.online.seat != null) ui.online.rematch[ui.online.seat] = true
  }

  function publishAim() {
    if (ui.online.status !== 'playing' || !state || state.phase !== 'aim') return
    if (ui.online.seat == null || ui.online.seat !== state.turn) return
    if (!engine) return
    if (state.turn !== lastAimTurn) {
      lastAimPayload = ''
      lastAimTurn = state.turn
    }
    const aim = engine.getAimState()
    const payload = JSON.stringify(aim)
    if (payload === lastAimPayload) return
    if (net.send({ type: 'aim', aim })) lastAimPayload = payload
  }

  function leaveRoom(silent = false) {
    if (!silent) net?.send({ type: 'leave' })
    net?.close()
    ui.online.status = 'idle'
    ui.online.code = ''
    ui.online.seat = null
    ui.online.players = []
    ui.online.rematch = [false, false]
    ui.online.opponentLeft = false
    ui.online.waiting = false
    ui.online.error = ''
    pendingServer = null
    lastAimPayload = ''
    lastAimTurn = null
    if (preOnlineGuide !== null) {
      applyGuide(preOnlineGuide, false)
      preOnlineGuide = null
    }
    ui.online.guide = ui.showGuide
    const preview = createMatch(ui.selectedMode)
    state = preview
    engine.loadMatch(state)
    ui.menu.kind = 'start'
    ui.menu.title = '选一张球桌，开局。'
    ui.menu.intro = '一杆的手感，一局的较量。选择你想玩的台球。'
    engine.setOverlayOpen(true)
    ui.menu.visible = true
    syncUi()
  }

  function bindNet(client) {
    client.on('room', (message) => {
      ui.online.code = message.code
      ui.online.seat = message.seat
      ui.online.players = message.players
      ui.online.rematch = message.rematch || [false, false]
      ui.online.guide = message.guide !== false
      ui.online.error = ''
      ui.selectedMode = message.mode
      ui.online.status = message.started ? 'playing' : 'room'
      if (!message.started) {
        ui.menu.kind = 'online'
        ui.menu.title = message.seat === 0 ? '房间已创建。' : `已加入 ${message.code} 房间。`
        ui.menu.intro =
          message.players.filter((player) => player.connected).length < 2
            ? `把房间码 ${message.code} 发给朋友，等他加入。`
            : '双方已就位，房主可以开始比赛。'
        ui.online.name = message.players[message.seat]?.name || ui.online.name
        ui.menu.visible = true
        engine?.setOverlayOpen(true)
      }
      syncUi()
    })

    client.on('start', (message) => {
      ui.online.status = 'playing'
      ui.online.waiting = false
      pendingServer = null
      lastAimPayload = ''
      lastAimTurn = null
      if (typeof message.guide === 'boolean') {
        if (preOnlineGuide === null) preOnlineGuide = ui.showGuide
        applyGuide(message.guide, false)
      }
      state = hydrateState(message.state)
      engine.loadMatch(state)
      closeMenu()
      syncUi()
    })

    client.on('aim', (message) => {
      if (ui.online.status !== 'playing') return
      if (!state || state.phase !== 'aim') return
      if (message.seat === ui.online.seat) return
      if (state.turn !== message.seat) return
      engine.applyRemoteAim(message.aim)
    })

    client.on('shot', (message) => {
      if (ui.online.status !== 'playing') return
      const mine = message.seat === ui.online.seat
      if (mine) {
        pendingServer = message.state
        if (!engine.animating && !engine.striking) {
          applyServerState(pendingServer)
          pendingServer = null
        }
        return
      }
      if (engine.animating) {
        pendingServer = message.state
        return
      }
      if (state.phase !== 'aim') {
        applyServerState(message.state)
        return
      }
      if (state.inHand && message.shot.cue) {
        const cue = state.balls[0]
        cue.x = message.shot.cue.x
        cue.y = message.shot.cue.y
        engine.applyState(state)
      }
      pendingServer = message.state
      engine.playShot(message.shot)
      syncUi()
    })

    client.on('peer', (message) => {
      if (message.event === 'joined') {
        ui.message = `${message.name || '对手'}加入了房间。`
      } else if (message.event === 'left') {
        ui.online.opponentLeft = true
        ui.online.waiting = false
        engine?.setInteraction(false)
        if (ui.online.status === 'playing') {
          showMenu(
            'online-left',
            '对手已离开。',
            '这局无法继续。你可以返回大厅，重新创建或加入房间。',
          )
        } else {
          ui.menu.kind = 'online'
          ui.menu.title = '对手已离开。'
          ui.menu.intro = '等待新的玩家加入，或返回大厅。'
          syncUi()
        }
      }
    })

    client.on('error', (message) => {
      ui.online.error = message.message || '联机服务出错了。'
      if (ui.online.status === 'connecting') ui.online.status = 'idle'
    })

    client.on('disconnect', () => {
      if (ui.online.status === 'idle') return
      ui.online.status = 'idle'
      ui.online.waiting = false
      ui.online.error = '与联机服务器的连接已断开。'
      showMenu(
        'online-left',
        '连接已断开',
        '请检查网络后重新进入联机大厅。',
      )
    })
  }

  function backToLobby() {
    leaveRoom()
  }

  /* ---------- 控制面板 ---------- */
  function setView(view) {
    engine?.setView(view)
  }

  function zoom(delta) {
    engine?.zoomView(delta)
  }

  function resetView() {
    engine?.resetView()
  }

  function nudge(delta) {
    engine?.rotateAim(delta)
  }

  function setPower(value) {
    engine?.setPower(value / 100)
  }

  function setSpin(spin) {
    engine?.setSpin(spin)
  }

  function shoot() {
    engine?.shoot()
  }

  return {
    canvasRef,
    ui,
    actions: {
      selectMode,
      startLocal,
      openMenu,
      resumeGame,
      toggleGuide,
      toggleSettings,
      closeSettings,
      setRoomGuide,
      setVolume,
      toggleMute,
      previewSound,
      setName,
      createRoom,
      joinRoom,
      startOnline,
      requestRematch,
      leaveRoom,
      backToLobby,
      setView,
      zoom,
      resetView,
      nudge,
      setPower,
      setSpin,
      shoot,
    },
  }
}

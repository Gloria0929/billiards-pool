import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
import { BilliardsEngine } from '../game/engine.js'
import { createMatch, hydrateState, offerStalemate, resolveBreakChoice as applyBreakChoice, resolveFrameChoice, snapshot } from '../game/match.js'
import { canConcedeFrame, endShot, offerConcession, snookerPointsRemaining } from '../game/rules.js'
import { MODES } from '../game/constants.js'
import {
  advanceSeries,
  createSeries,
  normalizeBestOf,
  publicSeries,
  recordFrameResult,
} from '../game/series.js'
import { AiPlanner } from '../game/ai-planner.js'
import * as audio from '../game/audio.js'
import { NetClient } from '../net/client.js'

const STORAGE_NAME = 'billiards-name'
const STORAGE_GUIDE = 'billiards-guide'
const STORAGE_GUIDE_MODE = 'billiards-guide-mode'
const STORAGE_DIFFICULTY = 'billiards-difficulty'
const STORAGE_BESTOF = 'billiards-bestof'
const STORAGE_ONLINE_SEAT = 'billiards-online-seat'
const AI_DIFFICULTIES = ['easy', 'normal', 'hard']
const AI_DIFFICULTY_LABELS = { easy: '简单', normal: '普通', hard: '困难' }

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
  let aiTimer = null
  const aiPlanner = new AiPlanner()
  let connectPromise = null
  let reservation = null
  let reconnectTimer = null
  let localSeries = createSeries(1)

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
    snookerBreak: 0,
    snookerBreakSeat: null,
    snookerRemaining: 0,
    snookerMaximum: null,
    snookerCentury: null,
    snookerCelebration: null,
    nineTarget: 0,
    nineRemaining: 0,
    snookerOnRed: true,
    snookerColorIndex: 0,
    snookerFinalColor: false,
    names: null,
    balls: [],
    message: '',
    winner: null,
    power: 0.45,
    playerPower: 0.45,
    charging: false,
    spin: { x: 0, y: 0 },
    playerSpin: { x: 0, y: 0 },
    view: 'orbit',
    showGuide: true,
    guideMode: 'simple',
    aiDifficulty: 'normal',
    aiShotReady: false,
    bestOf: 1,
    match: publicSeries(createSeries(1)),
    canShoot: false,
    canConcede: false,
    canRequestStalemate: false,
    modeLabel: '中式八球 · 本地双人',
    menu: {
      visible: true,
      kind: 'start',
      title: '选一张球桌，开局。',
      intro: '一杆的手感，一局的较量。选择你想玩的台球。',
      mine: true,
    },
    online: {
      status: 'idle',
      connected: false,
      code: '',
      seat: null,
      players: [],
      name: '',
      error: '',
      resumeCode: '',
      waiting: false,
      rematch: [false, false],
      guide: true,
      visibility: 'public',
      rooms: [],
      requests: [],
      closedNotice: '',
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
      if (localStorage.getItem(STORAGE_GUIDE_MODE) === 'full') ui.guideMode = 'full'
    } catch (_) {}
    try {
      const saved = localStorage.getItem(STORAGE_DIFFICULTY)
      if (AI_DIFFICULTIES.includes(saved)) ui.aiDifficulty = saved
    } catch (_) {}
    try {
      const saved = Number(localStorage.getItem(STORAGE_BESTOF))
      ui.bestOf = normalizeBestOf(saved)
      localSeries = createSeries(ui.bestOf)
    } catch (_) {}
    engine = new BilliardsEngine(canvasRef.value)
    engine.overlayOpen = true
    engine.showGuide = ui.showGuide
    engine.guideMode = ui.guideMode
    engine.onShoot = handleShoot
    engine.onRest = handleRest
    engine.onPower = (value, playerPower) => {
      ui.power = value
      ui.playerPower = playerPower ?? 0.45
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
    engine.onSpin = (spin, playerSpin) => {
      ui.spin = { x: spin.x, y: spin.y }
      ui.playerSpin = { x: playerSpin.x, y: playerSpin.y }
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
    for (const storage of [sessionStorage, localStorage]) {
      try {
        const saved = JSON.parse(storage.getItem(STORAGE_ONLINE_SEAT))
        if (!saved?.code || !saved?.token) continue
        reservation = saved
        ui.online.resumeCode = saved.code
        break
      } catch (_) {}
    }
    aimTimer = setInterval(publishAim, 60)
    document.addEventListener('keydown', onEscape)
    document.addEventListener('visibilitychange', scheduleReconnect)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', scheduleReconnect)
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
    clearAiTimer()
    clearTimeout(reconnectTimer)
    document.removeEventListener('keydown', onEscape)
    document.removeEventListener('visibilitychange', scheduleReconnect)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', scheduleReconnect)
    if (ui.online.status !== 'idle' && net?.ws?.readyState === 1)
      net.send({ type: 'leave' })
    net?.close()
    engine?.dispose()
    engine = null
  })

  /* ---------- 状态同步 ---------- */
  function syncUi({ celebrateBreak = false } = {}) {
    if (!state) return
    const snap = snapshot(state)
    ui.mode = snap.mode
    ui.modeName = snap.modeName
    ui.phase = snap.phase
    ui.turn = snap.turn
    ui.groups = snap.groups
    const prevBreak = ui.snookerBreak
    ui.scores = snap.scores
    ui.snookerBreak = snap.breakScore ?? 0
    ui.snookerBreakSeat = snap.breakSeat ?? null
    if (!snap.centuryBreak && !snap.maximumBreak) ui.snookerCelebration = null
    if (celebrateBreak) {
      if (snap.maximumBreak && !ui.snookerMaximum) {
        ui.snookerCelebration = { ...snap.maximumBreak, full: true }
        audio.playApplause(1)
      } else if (snap.centuryBreak && !ui.snookerCentury) {
        ui.snookerCelebration = { ...snap.centuryBreak, full: false }
        audio.playApplause(0.9)
      } else if (snap.mode === 'snk' && prevBreak < 50 && ui.snookerBreak >= 50) {
        audio.playApplause(0.55)
      }
    }
    ui.snookerMaximum = snap.maximumBreak
    ui.snookerCentury = snap.centuryBreak
    ui.snookerRemaining =
      snap.mode === 'snk' ? snookerPointsRemaining(state) : 0
    const nineBalls = snap.balls.filter((ball) => ball.on && ball.n > 0)
    ui.nineRemaining = nineBalls.length
    ui.nineTarget = nineBalls.length
      ? Math.min(...nineBalls.map((ball) => ball.n))
      : 0
    ui.snookerOnRed = snap.onRed
    ui.snookerColorIndex = snap.colorIndex
    ui.snookerFinalColor = snap.finalColor
    if (ui.online.status === 'idle') ui.match = publicSeries(localSeries)
    ui.names = snap.names
    ui.balls = snap.balls
    ui.message = snap.message
    ui.winner = snap.winner
    const onlinePlaying = ui.online.status === 'playing'
    ui.modeLabel =
      ui.online.status === 'room' || onlinePlaying
        ? `${snap.modeName} · 房间 ${ui.online.code}`
        : `${snap.modeName} · 人机对战 · ${AI_DIFFICULTY_LABELS[ui.aiDifficulty] || '普通'}`
    const myTurn = !onlinePlaying || ui.online.seat === state.turn
    const aiTurn =
      ui.online.status === 'idle' &&
      state.phase === 'aim' &&
      state.turn === 1
    const canPlay = state.phase === 'aim' && !ui.menu.visible &&
      myTurn && !ui.online.waiting && !aiTurn
    ui.canShoot = canPlay
    ui.canRequestStalemate = canPlay && !state.breakShot && !engine?.striking &&
      (onlinePlaying || state.quietShots >= 6)
    const playerSeat = onlinePlaying ? ui.online.seat : 0
    ui.canConcede =
      canConcedeFrame(state, playerSeat) &&
      !ui.online.waiting &&
      !engine?.striking
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
    audio.playApplause(0.75)
    if (ui.online.status === 'playing') {
      showMenu('online-over', state.message || '本局结束', '')
      return
    }
    recordFrameResult(localSeries, state.winner)
    showMenu('local-over', state.message || '本局结束', '')
  }

  /* ---------- 本地对局 ---------- */
  function selectMode(mode) {
    if (ui.online.status === 'room' || ui.online.status === 'playing') return
    ui.selectedMode = mode
  }

  // 没有个人力度记录时，使用当前玩法的开球力度。
  function primeBreakPower() {
    if (!state || !engine || engine.playerPower !== null) return
    const mySeat = ui.online.status === 'playing' ? ui.online.seat : 0
    if (state.phase === 'aim' && state.breakShot && state.turn === mySeat)
      engine.setPower(MODES[state.mode].breakPower, false)
  }

  function startLocal() {
    if (ui.online.status !== 'idle') resetOnlineRoom()
    localSeries = createSeries(ui.bestOf)
    startLocalFrame()
  }

  function startLocalFrame() {
    clearAiTimer()
    audio.ensureAudio()
    const seed = (Math.random() * 2 ** 32) >>> 0
    state = createMatch(ui.selectedMode, seed, ['你', '电脑'])
    state.breakMisses = [...localSeries.breakMisses]
    if (localSeries.frame % 2 === 0) {
      state.turn = state.opener = 1
      state.message = '电脑 开球 · 等待电脑击球'
    }
    engine.loadMatch(state)
    primeBreakPower()
    audio.restoreMaster()
    closeMenu()
    syncUi()
    maybeScheduleAi()
  }

  function playAgainLocal() {
    if (ui.online.status !== 'idle' || state?.phase !== 'over') return
    if (!advanceSeries(localSeries)) return
    startLocalFrame()
  }

  function exitToHome() {
    if (ui.online.status !== 'idle') {
      leaveRoom()
      return
    }
    clearAiTimer()
    const preview = createMatch(ui.selectedMode)
    state = preview
    engine?.loadMatch(state)
    showMenu(
      'start',
      '选一张球桌，开局。',
      '一杆的手感，一局的较量。选择你想玩的台球。',
    )
  }

  function openMenu() {
    if (ui.online.status === 'playing') return
    if (!state) return
    clearAiTimer()
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
    if (state?.phase === 'choice' && state.breakChoice) {
      if (ui.online.status === 'playing') syncOnlineBreakChoice()
      else {
        openBreakChoice()
        if (state.breakChoice.seat === 1) scheduleAiBreakChoice()
      }
      return
    }
    if (state?.phase === 'choice' && state.sn?.choice) {
      if (ui.online.status === 'playing') syncOnlineFoulChoice()
      else {
        openFoulChoice()
        if (state.sn.choice.seat === 1) scheduleAiFoulChoice()
      }
      return
    }
    maybeScheduleAi()
  }

  function clearAiTimer() {
    aiPlanner.cancel()
    if (aiTimer) clearTimeout(aiTimer)
    aiTimer = null
    ui.aiShotReady = false
  }

  function aiTurnReady() {
    return (
      ui.online.status === 'idle' &&
      !!state &&
      state.phase === 'aim' &&
      state.turn === 1 &&
      !ui.menu.visible &&
      !!engine
    )
  }

  function maybeScheduleAi() {
    clearAiTimer()
    if (!aiTurnReady()) return
    aiTimer = setTimeout(runAiTurn, 900)
  }

  async function runAiTurn() {
    aiTimer = null
    if (!aiTurnReady()) return
    const shot = await aiPlanner.plan(state, 1, ui.aiDifficulty)
    if (!shot || !aiTurnReady()) return
    engine.angle = shot.angle
    engine.setPower(shot.power, false)
    engine.setSpin(shot.spin, false)
    ui.aiShotReady = true
    aiTimer = setTimeout(() => {
      aiTimer = null
      if (!aiTurnReady()) return
      engine.playShot(shot)
      syncUi()
    }, 750)
  }

  /* ---------- 中八开球失机：接受台面 / 重新开球 ---------- */
  function openBreakChoice() {
    const choice = state?.breakChoice
    if (!choice) return
    const mine =
      ui.online.status === 'playing'
        ? choice.seat === ui.online.seat
        : choice.seat === 0
    // 本地对战由电脑做决定时不再弹窗，打完这一杆的提示已经足够。
    if (ui.online.status !== 'playing' && !mine) return
    showMenu(
      'break-choice',
      state.message,
      mine ? '' : '等待对手选择。',
    )
    ui.menu.mine = mine
    ui.menu.breakKind = choice.kind
    ui.menu.offender = choice.offender
    ui.menu.seat = choice.seat
  }

  function resolveBreakChoiceAction(decision, target = null) {
    const choice = state?.breakChoice
    if (!choice) return
    const rerack = decision === 'rerack'
    if (ui.online.status === 'playing') {
      const breakerSeat = rerack
        ? target === 'self'
          ? ui.online.seat
          : choice.offender
        : null
      if (!net.send({ type: 'break-choice', decision, breakerSeat })) return
      ui.online.waiting = true
      closeMenu()
      syncUi()
      return
    }
    const seat = rerack
      ? target === 'self'
        ? choice.seat
        : choice.offender
      : null
    applyBreakChoice(state, rerack ? 'rerack' : 'accept', seat)
    if (state.mode === 'pool') localSeries.breakMisses = [...state.breakMisses]
    closeMenu()
    if (rerack) {
      engine?.loadMatch(state)
      primeBreakPower()
    } else engine?.applyState(state)
    syncUi()
    maybeScheduleAi()
  }

  function scheduleAiBreakChoice() {
    clearAiTimer()
    aiTimer = setTimeout(() => {
      aiTimer = null
      if (
        ui.online.status === 'idle' &&
        state?.phase === 'choice' &&
        state.breakChoice?.seat === 1
      )
        resolveBreakChoiceAction(
          state.breakChoice.kind === 'no-contact' ? 'rerack' : 'accept',
          'self',
        )
    }, 900)
  }

  function syncOnlineBreakChoice() {
    if (ui.online.status !== 'playing') return
    const choice = state?.breakChoice
    if (state?.phase === 'choice' && choice) {
      const mine = choice.seat === ui.online.seat
      if (
        !ui.menu.visible ||
        ui.menu.kind !== 'break-choice' ||
        ui.menu.mine !== mine
      )
        openBreakChoice()
    } else if (ui.menu.visible && ui.menu.kind === 'break-choice') {
      closeMenu()
    }
  }

  /* ---------- 斯诺克犯规后的选择 / 复位 ---------- */
  function openFoulChoice() {
    const choice = state?.sn?.choice
    if (!choice) return
    const mine =
      ui.online.status === 'playing'
        ? choice.seat === ui.online.seat
        : choice.seat === 0
    // 本地对战由电脑做决定时不再弹窗，打完这一杆的提示已经足够。
    if (ui.online.status !== 'playing' && !mine) return
    showMenu(
      'foul-choice',
      choice.kind ? state.message : '犯规判罚。',
      choice.kind ? (mine ? '' : '等待对手选择。') : mine
        ? `罚分已计入。你可以自己击球、让对手从球停下的位置重打${
            choice.miss ? '，或让他回到犯规前的球位重打' : ''
          }。${
            choice.freeBall
              ? ' 白球被完全挡住，下一步可以选择自由球。'
              : ''
          }${
            choice.warn
              ? ' 若再次要求回原位重打，对手未击中目标球将判负。'
              : ''
          }`
        : `等待对手选择：自己击球、让你从当前位置重打${
            choice.miss ? '，或让你回到犯规前的球位重打' : ''
          }。`,
    )
    ui.menu.mine = mine
    ui.menu.choiceKind = choice.kind
    ui.menu.miss = !!choice.miss
    ui.menu.warn = !!choice.warn
    ui.menu.freeBall = !!choice.freeBall
  }

  function syncOnlineFoulChoice() {
    if (ui.online.status !== 'playing') return
    const choice = state?.sn?.choice
    if (state?.phase === 'choice' && choice) {
      const mine = choice.seat === ui.online.seat
      if (
        !ui.menu.visible ||
        ui.menu.kind !== 'foul-choice' ||
        ui.menu.mine !== mine
      )
        openFoulChoice()
    } else if (ui.menu.visible && ui.menu.kind === 'foul-choice') {
      closeMenu()
    }
  }

  function scheduleAiFoulChoice() {
    clearAiTimer()
    aiTimer = setTimeout(() => {
      aiTimer = null
      if (
        ui.online.status === 'idle' &&
        state?.phase === 'choice' &&
        state.sn?.choice?.seat === 1
      ) {
        const choice = state.sn.choice
        const seqColor =
          state.sn.onRed || state.sn.finalColor
            ? null
            : 16 + state.sn.idx
        const color = choice.freeBall
          ? [21, 20, 19, 18, 17, 16].find(
              (n) =>
                n !== seqColor &&
                state.balls.some((ball) => ball.on && ball.n === n),
            ) || null
          : null
        resolveFoulChoice('play', color)
      }
    }, 900)
  }

  function chooseFoulPlay() {
    const choice = state?.sn?.choice
    if (!choice) return
    if (choice.freeBall) {
      showMenu(
        'free-ball',
        '自由球。',
        '你可以选另一颗彩球代替当前目标球，也可以按原目标击球。',
      )
    } else resolveFoulChoice('play')
  }

  function resolveFoulChoice(decision, freeBall = null) {
    if (!state?.sn?.choice) return
    if (ui.online.status === 'playing') {
      if (!net.send({ type: 'choice', decision, freeBall })) return
      ui.online.waiting = true
      if (ui.menu.visible) closeMenu()
      syncUi()
      return
    }
    state = resolveFrameChoice(state, decision, freeBall)
    closeMenu()
    engine?.applyState(state)
    syncUi()
    if (state.phase === 'over') openOverlayForResult()
    else maybeScheduleAi()
  }

  function requestStalemate() {
    if (!ui.canRequestStalemate || engine?.striking) return
    if (ui.online.status === 'playing') {
      if (!net.send({ type: 'stalemate' })) return
      ui.online.waiting = true
    } else {
      offerStalemate(state)
      state = resolveFrameChoice(state, 'play')
      engine?.applyState(state)
      primeBreakPower()
      maybeScheduleAi()
    }
    syncUi()
  }

  /* ---------- 斯诺克认输 ---------- */
  function openConcedeConfirm() {
    if (!ui.canConcede) return
    showMenu(
      'concede',
      '确认认输？',
      '已有一方需要靠罚分追分。提出认输后，由对手决定是否接受。',
    )
  }

  function cancelConcede() {
    if (ui.menu.kind !== 'concede') return
    closeMenu()
    syncUi()
    maybeScheduleAi()
  }

  function confirmConcede() {
    if (!ui.canConcede) return
    if (ui.online.status === 'playing') {
      if (!net.send({ type: 'concede' })) return
      closeMenu()
      ui.online.waiting = true
      syncUi()
      return
    }
    offerConcession(state, 0)
    closeMenu()
    engine?.applyState(state)
    syncUi()
    scheduleAiFoulChoice()
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

  function setGuideMode(mode) {
    if (mode !== 'simple' && mode !== 'full') return
    ui.guideMode = mode
    if (engine) engine.guideMode = mode
    try {
      localStorage.setItem(STORAGE_GUIDE_MODE, mode)
    } catch (_) {}
  }

  function setRoomGuide(value) {
    if (!['idle', 'connecting'].includes(ui.online.status)) return
    ui.online.guide = !!value
  }

  /* ---------- 人机对战 AI 难度（仅本地，不影响联网） ---------- */
  function setAiDifficulty(value) {
    if (!AI_DIFFICULTIES.includes(value)) return
    ui.aiDifficulty = value
    try {
      localStorage.setItem(STORAGE_DIFFICULTY, value)
    } catch (_) {}
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
      } else {
        ui.online.waiting = true
        syncUi()
      }
      return
    }
    endShot(state)
    if (state.mode === 'pool') localSeries.breakMisses = [...state.breakMisses]
    syncUi({ celebrateBreak: true })
    if (state.phase === 'over') {
      openOverlayForResult()
      return
    }
    if (state.phase === 'choice' && state.breakChoice) {
      openBreakChoice()
      if (state.breakChoice.seat === 1) scheduleAiBreakChoice()
      return
    }
    if (state.phase === 'choice' && state.sn?.choice) {
      openFoulChoice()
      if (state.sn.choice.seat === 1) scheduleAiFoulChoice()
      return
    }
    maybeScheduleAi()
  }

  function applyServerState({ state: next, match }) {
    state = hydrateState(next)
    if (match) ui.match = publicSeries(match)
    ui.online.waiting = false
    pendingServer = null
    engine.applyState(state)
    primeBreakPower()
    syncUi({ celebrateBreak: true })
    if (state.phase === 'over' && ui.online.status === 'playing') openOverlayForResult()
    else {
      syncOnlineBreakChoice()
      syncOnlineFoulChoice()
    }
  }

  /* ---------- 联机 ---------- */
  function rememberSeat(code, token) {
    if (!token || (reservation?.code === code && reservation.token === token)) return
    reservation = { code, token }
    ui.online.resumeCode = code
    for (const storage of [sessionStorage, localStorage]) {
      try { storage.setItem(STORAGE_ONLINE_SEAT, JSON.stringify(reservation)) } catch (_) {}
    }
  }

  function forgetSeat() {
    for (const storage of [sessionStorage, localStorage]) {
      try {
        const saved = JSON.parse(storage.getItem(STORAGE_ONLINE_SEAT))
        if (saved?.token === reservation?.token) storage.removeItem(STORAGE_ONLINE_SEAT)
      } catch (_) {}
    }
    reservation = null
    ui.online.resumeCode = ''
  }

  function beginReconnect() {
    ui.online.status = 'reconnecting'
    ui.online.connected = false
    ui.online.waiting = false
    showMenu('online-left', '正在重新连接', '电脑会在你离开时接管你的回合。')
  }

  function scheduleReconnect() {
    if (ui.online.status !== 'reconnecting' || document.hidden || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      tryResume()
    }, 1200)
  }

  function tryResume() {
    if (ui.online.status !== 'reconnecting' || document.hidden) return
    net.connect()
      .then(() => {
        if (ui.online.status === 'reconnecting' && reservation &&
            !net.send({ type: 'resume', ...reservation }))
          scheduleReconnect()
      })
      .catch(scheduleReconnect)
  }

  function resumeRoom() {
    if (!reservation || !['idle', 'connecting'].includes(ui.online.status)) return
    clearAiTimer()
    beginReconnect()
    tryResume()
  }

  function onPageHide() {
    if (ui.online.status === 'playing' && reservation) beginReconnect()
    if (ui.online.status === 'reconnecting') net.close()
  }

  function setName(value) {
    ui.online.name = value
    try {
      localStorage.setItem(STORAGE_NAME, value)
    } catch (_) {}
  }

  function ensureConnected() {
    if (net?.ws?.readyState === 1) return Promise.resolve()
    if (connectPromise) return connectPromise
    ui.online.status = 'connecting'
    ui.online.error = ''
    const connection = net.connect()
      .then(() => {
        if (connectPromise !== connection) throw new Error('connect cancelled')
        ui.online.connected = true
        if (ui.online.status === 'connecting') ui.online.status = 'idle'
      })
      .catch(() => {
        if (connectPromise === connection && ui.online.status === 'connecting') {
          ui.online.status = 'idle'
          ui.online.connected = false
        }
        throw new Error('connect failed')
      })
      .finally(() => {
        if (connectPromise === connection) connectPromise = null
      })
    connectPromise = connection
    return connection
  }

  function createRoom() {
    ensureConnected()
      .then(() => {
        net.send({
          type: 'create',
          mode: ui.selectedMode,
          name: ui.online.name,
          guide: ui.online.guide,
          visibility: ui.online.visibility,
          bestOf: ui.bestOf,
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
    if (cleaned === reservation?.code) {
      resumeRoom()
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

  function requestRooms() {
    if (ui.online.status !== 'idle') return
    ensureConnected()
      .then(() => net.send({ type: 'rooms' }))
      .catch(() => {})
  }

  function respondJoinRequest(id, accept) {
    if (ui.online.status !== 'room' || ui.online.seat !== 0) return
    net.send({ type: 'respond', id, accept: !!accept })
  }

  function cancelJoinRequest() {
    if (ui.online.status !== 'requesting') return
    net.send({ type: 'cancel-join' })
    ui.online.status = 'idle'
    ui.online.error = ''
  }

  function setBestOf(value) {
    const best = normalizeBestOf(value)
    ui.bestOf = best
    try {
      localStorage.setItem(STORAGE_BESTOF, String(best))
    } catch (_) {}
  }

  function setRoomVisibility(value) {
    if (!['idle', 'connecting'].includes(ui.online.status)) return
    ui.online.visibility = value === 'private' ? 'private' : 'public'
  }

  function requestRematch() {
    if (ui.online.status !== 'playing' || state?.phase !== 'over' || ui.match.over) return
    const seat = ui.online.seat
    if (seat == null || ui.online.rematch[seat]) return
    if (net.send({ type: 'rematch' })) ui.online.rematch[seat] = true
  }

  function publishAim() {
    if (ui.online.status !== 'playing' || !ui.online.connected || ui.online.waiting ||
        !state || state.phase !== 'aim') return
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

  function resetOnlineRoom() {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    if (ui.online.status !== 'idle' && net?.ws?.readyState === 1)
      net.send({ type: 'leave' })
    net?.close()
    connectPromise = null
    ui.online.status = 'idle'
    ui.online.connected = false
    ui.online.code = ''
    ui.online.seat = null
    ui.online.players = []
    ui.online.rematch = [false, false]
    ui.online.requests = []
    ui.online.waiting = false
    ui.online.error = ''
    ui.online.closedNotice = ''
    pendingServer = null
    lastAimPayload = ''
    lastAimTurn = null
    if (preOnlineGuide !== null) {
      applyGuide(preOnlineGuide, false)
      preOnlineGuide = null
    }
    ui.online.guide = true
  }

  function leaveRoom() {
    clearAiTimer()
    if (ui.online.status === 'playing' && ui.match.over) forgetSeat()
    resetOnlineRoom()
    state = createMatch(ui.selectedMode)
    engine.loadMatch(state)
    showMenu('lobby', '游戏大厅', '')
  }

  function bindNet(client) {
    client.on('room', (message) => {
      if (message.state && ui.online.status !== 'reconnecting') return
      if (message.started) rememberSeat(message.code, message.token)
      ui.online.code = message.code
      ui.online.seat = message.seat
      ui.online.players = message.players
      ui.online.rematch = message.rematch || [false, false]
      ui.online.guide = message.guide !== false
      ui.online.visibility =
        message.visibility === 'private' ? 'private' : 'public'
      ui.online.requests = []
      ui.online.connected = true
      // 对局中的局分随击球结果一起同步，房间通知可能先到。
      if (message.match && (!message.started || state?.phase === 'over'))
        ui.match = publicSeries(message.match)
      ui.online.error = ''
      ui.selectedMode = message.mode
      ui.online.status = message.started ? 'playing' : 'room'
      if (message.state) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
        loadOnlineState(message)
        if (state.phase === 'over') openOverlayForResult()
        else {
          syncOnlineBreakChoice()
          syncOnlineFoulChoice()
        }
        return
      }
      if (!message.started) {
        ui.menu.kind = 'online'
        ui.menu.title = message.seat === 0 ? '房间已创建。' : `已加入 ${message.code} 房间。`
        ui.menu.intro =
          message.players.filter((player) => player.connected).length < 2
            ? message.visibility === 'public'
              ? '公开房间已上线，等待大厅里的球友申请加入。'
              : `把房间码 ${message.code} 发给朋友，等他加入。`
            : '双方已就位，房主可以开始比赛。'
        ui.online.name = message.players[message.seat]?.name || ui.online.name
        ui.menu.visible = true
        engine?.setOverlayOpen(true)
      }
      syncUi()
    })

    client.on('resume-denied', (message) => {
      if (ui.online.status !== 'reconnecting' || message.code !== reservation?.code) return
      forgetSeat()
      leaveRoom()
      ui.online.error = message.message
    })

    client.on('rooms', (message) => {
      ui.online.rooms = Array.isArray(message.rooms) ? message.rooms : []
    })

    client.on('join-request', (message) => {
      if (ui.online.seat !== 0) return
      const item = {
        id: message.id,
        name: message.name,
        code: message.code,
      }
      ui.online.requests = [
        ...ui.online.requests.filter((request) => request.id !== item.id),
        item,
      ].slice(-5)
    })

    client.on('join-request-resolved', (message) => {
      ui.online.requests = ui.online.requests.filter(
        (request) => request.id !== message.id,
      )
    })

    client.on('join-request-cancelled', (message) => {
      ui.online.requests = ui.online.requests.filter(
        (request) => request.id !== message.id,
      )
    })

    client.on('join-pending', (message) => {
      ui.online.status = 'requesting'
      ui.online.code = message.code || ''
      ui.online.error = ''
      if (!['start', 'paused', 'lobby'].includes(ui.menu.kind)) {
        ui.menu.kind = 'online'
        ui.menu.title = '申请已发送。'
        ui.menu.intro = '等待房主同意你的加入申请。'
      }
      ui.menu.visible = true
      engine?.setOverlayOpen(true)
      syncUi()
    })

    client.on('join-denied', (message) => {
      ui.online.status = 'idle'
      ui.online.code = ''
      ui.online.error = message.message || '房主没有同意加入。'
      syncUi()
    })

    client.on('room-closed', (message) => {
      ui.online.status = 'idle'
      ui.online.code = ''
      ui.online.guide = true
      ui.online.seat = null
      ui.online.players = []
      ui.online.requests = []
      ui.online.rematch = [false, false]
      ui.online.waiting = false
      ui.online.error = message.message || '房间已关闭。'
      ui.online.closedNotice = ui.online.error
      const preview = createMatch(ui.selectedMode)
      state = preview
      engine?.loadMatch(state)
      syncUi()
      showMenu('online', '房间已关闭。', ui.online.error)
    })

    function loadOnlineState(message) {
      ui.online.status = 'playing'
      ui.online.waiting = false
      ui.online.requests = []
      ui.snookerCelebration = null
      if (message.match) ui.match = publicSeries(message.match)
      pendingServer = null
      lastAimPayload = ''
      lastAimTurn = null
      if (typeof message.guide === 'boolean') {
        if (preOnlineGuide === null) preOnlineGuide = ui.showGuide
        applyGuide(message.guide, false)
      }
      state = hydrateState(message.state)
      engine.loadMatch(state, { keepPlayerAim: true })
      primeBreakPower()
      closeMenu()
    }

    client.on('start', loadOnlineState)

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
        if (engine.animating || engine.striking) pendingServer = message
        else applyServerState(message)
        return
      }
      if (engine.animating || engine.striking) {
        pendingServer = message
        return
      }
      if (state.phase !== 'aim') {
        applyServerState(message)
        return
      }
      if (state.inHand && message.shot.cue) {
        const cue = state.balls[0]
        cue.x = message.shot.cue.x
        cue.y = message.shot.cue.y
        engine.applyState(state)
      }
      pendingServer = message
      engine.playShot(message.shot)
      syncUi()
    })

    client.on('state', (message) => {
      if (ui.online.status !== 'playing') return
      if (engine.animating || engine.striking) {
        pendingServer = message
        return
      }
      applyServerState(message)
    })

    client.on('peer', (message) => {
      if (message.event === 'joined') {
        ui.message = `${message.name || '对手'}加入了房间。`
      } else if (message.event === 'left') {
        if (ui.online.status === 'room') {
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
      if (ui.online.status === 'playing' && !engine?.striking && !engine?.animating) {
        ui.online.waiting = false
        syncUi()
      }
      if (ui.online.status === 'playing' && state?.phase === 'choice') {
        ui.online.waiting = false
        if (state.breakChoice) openBreakChoice()
        else openFoulChoice()
      }
    })

    client.on('disconnect', (event) => {
      ui.online.connected = false
      if (event?.code === 4001) {
        leaveRoom()
        ui.online.error = '对局已在另一个页面恢复。'
        return
      }
      if (ui.online.status === 'playing' && reservation) beginReconnect()
      if (ui.online.status === 'reconnecting') {
        scheduleReconnect()
        return
      }
      if (!['room', 'playing', 'requesting'].includes(ui.online.status)) return
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

  /* ---------- 控制面板 ---------- */
  function setView(view) {
    engine?.setView(view)
  }

  function setPeekTop(active) {
    engine?.setPeekTop(active)
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
    if (ui.canShoot) engine?.setPower(value / 100)
  }

  function setSpin(spin) {
    if (ui.canShoot) engine?.setSpin(spin)
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
      setAiDifficulty,
      openMenu,
      resumeGame,
      chooseFoulPlay,
      resolveFoulChoice,
      resolveBreakChoice: resolveBreakChoiceAction,
      openConcedeConfirm,
      requestStalemate,
      confirmConcede,
      cancelConcede,
      toggleGuide,
      setGuideMode,
      toggleSettings,
      closeSettings,
      setRoomGuide,
      setRoomVisibility,
      setBestOf,
      setVolume,
      toggleMute,
      previewSound,
      setName,
      createRoom,
      joinRoom,
      resumeRoom,
      requestRooms,
      startOnline,
      requestRematch,
      respondJoinRequest,
      cancelJoinRequest,
      playAgainLocal,
      exitToHome,
      leaveRoom,
      setView,
      setPeekTop,
      zoom,
      resetView,
      nudge,
      setPower,
      setSpin,
      shoot,
    },
  }
}

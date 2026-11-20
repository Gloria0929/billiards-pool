import { recordedPCM } from './sounds.js'

let AC = null
let master = null
let rollGain = null
let rollFilter = null
let noiseBuffer = null
let voices = 0
let lastPlayed = {}
let audioBuffers = {}
let volume = 0.7
let muted = false
let unavailable = false

try {
  const prefs = JSON.parse(localStorage.getItem('billiards-audio') || '{}')
  if (Number.isFinite(prefs.volume))
    volume = Math.max(0, Math.min(1, prefs.volume))
  muted = prefs.muted === true
} catch (_) {}
let onStateChange = null

export const audioState = () => ({
  volume,
  muted,
  unavailable,
  running: !!AC && AC.state === 'running',
})

function persist() {
  try {
    localStorage.setItem(
      'billiards-audio',
      JSON.stringify({ volume, muted }),
    )
  } catch (_) {}
  onStateChange?.()
}

function applyMaster() {
  if (master && AC)
    master.gain.setTargetAtTime(
      muted ? 0 : volume * 0.8,
      AC.currentTime,
      0.025,
    )
}

function recordedBuffer(encoded) {
  const raw = atob(encoded)
  const buffer = AC.createBuffer(1, raw.length / 2, 32000)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const word = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
    data[i] = (word > 32767 ? word - 65536 : word) / 32768
  }
  return buffer
}

function initAudio() {
  master = AC.createGain()
  const compressor = AC.createDynamicsCompressor()
  compressor.threshold.value = -10
  compressor.knee.value = 12
  compressor.ratio.value = 4
  compressor.attack.value = 0.003
  compressor.release.value = 0.12
  master.connect(compressor)
  compressor.connect(AC.destination)

  for (const kind of ['c', 'b', 'r', 'p'])
    audioBuffers[kind] = recordedPCM[kind].map(recordedBuffer)

  noiseBuffer = AC.createBuffer(1, AC.sampleRate, AC.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const rolling = AC.createBufferSource()
  rolling.buffer = noiseBuffer
  rolling.loop = true
  rollFilter = AC.createBiquadFilter()
  rollFilter.type = 'lowpass'
  rollFilter.frequency.value = 180
  rollGain = AC.createGain()
  rollGain.gain.value = 0
  rolling.connect(rollFilter)
  rollFilter.connect(rollGain)
  rollGain.connect(master)
  rolling.start()
  applyMaster()
}

export function ensureAudio() {
  if (unavailable) return null
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
      })
      initAudio()
    } catch (_) {
      unavailable = true
      onStateChange?.()
      return null
    }
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {})
  onStateChange?.()
  return AC
}

export function setAudioListener(listener) {
  onStateChange = listener
}

export function setVolume(value) {
  volume = Math.max(0, Math.min(1, value))
  muted = false
  applyMaster()
  persist()
}

export function setMuted(value) {
  muted = !!value
  applyMaster()
  persist()
}

export function toggleMuted() {
  setMuted(!muted)
}

export function playPreview() {
  const ctx = ensureAudio()
  if (!ctx) return
  ctx.resume().then(() => playEvent('c', 3800, 0, 'preview')).catch(() => {})
}

export function playEvent(kind, speed, pan = 0, id = kind) {
  if (
    !AC ||
    AC.state !== 'running' ||
    muted ||
    !volume ||
    voices >= 32 ||
    (kind !== 'p' && speed < 35)
  )
    return
  const now = AC.currentTime
  const key = kind + ':' + id
  if (kind !== 'c' && now - (lastPlayed[key] ?? -1) < (kind === 'r' ? 0.035 : 0.012))
    return
  lastPlayed[key] = now
  const source = AC.createBufferSource()
  const gain = AC.createGain()
  const panner = AC.createStereoPanner()
  source.buffer =
    audioBuffers[kind][Math.floor(Math.random() * audioBuffers[kind].length)]
  source.playbackRate.value = 0.98 + Math.random() * 0.04
  const intensity = Math.min(
    1,
    Math.pow(Math.max(speed, kind === 'p' ? 650 : 0) / 5000, 0.58),
  )
  gain.gain.value =
    (0.06 + intensity * 0.85) * (kind === 'r' ? 0.75 : kind === 'p' ? 0.85 : 1)
  panner.pan.value = Math.max(-0.8, Math.min(0.8, pan))
  source.connect(gain)
  gain.connect(panner)
  panner.connect(master)
  voices++
  source.onended = () => {
    voices--
    source.disconnect()
    gain.disconnect()
    panner.disconnect()
  }
  source.start(now)
}

export function rollSound(speed) {
  if (!AC || !rollGain) return
  const now = AC.currentTime
  rollGain.gain.setTargetAtTime(Math.min(0.035, speed / 100000), now, 0.08)
  rollFilter.frequency.setTargetAtTime(
    100 + Math.min(300, speed * 0.08),
    now,
    0.08,
  )
}

// 克鲁斯堡剧场柔和掌声（轻量合成，不增加额外音频体积）
export function playApplause(strength = 0.6) {
  if (!AC || AC.state !== 'running' || muted || !volume || !noiseBuffer) return
  const now = AC.currentTime
  const duration = 1.6 + strength * 1.4
  const bursts = Math.round(6 + strength * 6)
  for (let i = 0; i < bursts; i++) {
    const start = now + i * 0.09 + Math.random() * 0.06
    const src = AC.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const band = AC.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1150 + Math.random() * 1400
    band.Q.value = 1.6 + Math.random() * 1.2
    const gain = AC.createGain()
    const peak = (0.018 + strength * 0.028) * (0.7 + Math.random() * 0.5)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(peak, start + 0.14 + Math.random() * 0.12)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * (0.55 + Math.random() * 0.45))
    const panner = AC.createStereoPanner()
    panner.pan.value = (Math.random() - 0.5) * 1.3
    src.connect(band)
    band.connect(gain)
    gain.connect(panner)
    panner.connect(master)
    src.start(start)
    src.stop(start + duration + 0.1)
    src.onended = () => {
      src.disconnect()
      band.disconnect()
      gain.disconnect()
      panner.disconnect()
    }
  }
}

export function silence() {
  rollSound(0)
  if (master && AC) master.gain.setTargetAtTime(0, AC.currentTime, 0.02)
}

export function restoreMaster() {
  applyMaster()
}

export function suspendAudio() {
  rollSound(0)
  AC?.suspend().catch(() => {})
}

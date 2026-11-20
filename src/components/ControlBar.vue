<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import SpinPad from './SpinPad.vue'
import { AIM_NUDGE } from '../game/constants.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

let aimTimer = null
let aimHeld = 0
let powerTimer = null
const powerTrack = ref(null)
const draggingPower = ref(false)

const PRESETS = [
  { label: '轻', value: 20 },
  { label: '中', value: 45 },
  { label: '重', value: 75 },
]

const finePointer = window.matchMedia('(pointer: fine)').matches
const spin = computed(() => props.ui.canShoot ? props.ui.spin : props.ui.playerSpin)
const powerPercent = computed(() =>
  Math.round((props.ui.canShoot ? props.ui.power : props.ui.playerPower) * 100),
)

const spinLabel = computed(() => {
  const x = spin.value.x || 0
  const y = spin.value.y || 0
  if (Math.hypot(x, y) < 0.08) return '中杆'
  const parts = []
  if (y > 0.12) parts.push('高杆')
  else if (y < -0.12) parts.push('低杆')
  if (x < -0.12) parts.push('左塞')
  else if (x > 0.12) parts.push('右塞')
  return parts.length ? parts.join('·') : '中杆'
})

const powerTone = computed(() => {
  const p = powerPercent.value
  if (p <= 25) return '轻推'
  if (p <= 55) return '走位'
  if (p <= 80) return '发力'
  return '强攻'
})

const hint = computed(() => {
  let text =
    props.ui.view === 'top'
      ? '点击 / 拖动瞄准 · 自由球可拖动白球'
      : props.ui.view === 'orbit'
        ? '轻点瞄准 · 拖动环绕 · 滚轮缩放 · 按住 T 俯瞰'
        : '左右拖动瞄准（按住 Shift 精细微调）· 上下调高度 · 按住 T 俯瞰'
  if (finePointer) text += ' · 按空格 / 点「击球」按设定力度出杆 · 右键后拽手动拉杆'
  return text
})

function updatePowerFromPointer(event) {
  const el = powerTrack.value
  if (!el || !props.ui.canShoot) return
  const rect = el.getBoundingClientRect()
  const vertical = rect.height >= rect.width
  const ratio = vertical
    ? 1 - (event.clientY - rect.top) / rect.height
    : (event.clientX - rect.left) / rect.width
  const value = Math.max(1, Math.min(100, Math.round(ratio * 100)))
  props.actions.setPower(value)
}

function onPowerDown(event) {
  if (!props.ui.canShoot) return
  draggingPower.value = true
  powerTrack.value?.setPointerCapture(event.pointerId)
  updatePowerFromPointer(event)
}

function onPowerMove(event) {
  if (!draggingPower.value) return
  updatePowerFromPointer(event)
}

function onPowerUp() {
  draggingPower.value = false
}

function onPowerWheel(event) {
  if (!props.ui.canShoot) return
  const step = event.shiftKey ? 1 : 2
  const delta = event.deltaY < 0 ? step : -step
  props.actions.setPower(Math.max(1, Math.min(100, powerPercent.value + delta)))
}

let powerDelay = null

function stepPower(delta) {
  if (!props.ui.canShoot) return
  props.actions.setPower(Math.max(1, Math.min(100, powerPercent.value + delta)))
}

function beginPowerStep(delta) {
  if (!props.ui.canShoot) return
  stopPowerStep()
  stepPower(delta)
  // 长按超过 320ms 才进入连续增减，避免单击触发两次
  powerDelay = setTimeout(() => {
    powerDelay = null
    powerTimer = setInterval(() => stepPower(delta), 70)
  }, 320)
}

function stopPowerStep() {
  if (powerDelay) clearTimeout(powerDelay)
  powerDelay = null
  if (powerTimer) clearInterval(powerTimer)
  powerTimer = null
}

function nudge(direction, step) {
  props.actions.nudge(direction * step)
}

function beginNudge(direction) {
  if (!props.ui.canShoot) return
  stopNudge()
  aimHeld = 0
  nudge(direction, AIM_NUDGE)
  aimTimer = setInterval(() => {
    const step = AIM_NUDGE * (1 + Math.min(aimHeld++, 12) * 0.1)
    nudge(direction, step)
  }, 40)
}

function stopNudge() {
  if (aimTimer) clearInterval(aimTimer)
  aimTimer = null
}

onBeforeUnmount(() => {
  stopNudge()
  stopPowerStep()
})
</script>

<template>
  <aside
    id="ctl"
    :class="{ 'is-moving': ui.phase === 'moving' }"
    :inert="ui.menu.visible"
    aria-label="击球控制面板"
  >
    <div class="spin-wrap" title="拖动调整旋转击点（双击归中）">
      <SpinPad
        :spin="spin"
        :disabled="!ui.canShoot"
        @update="actions.setSpin"
      />
      <small>{{ spinLabel }}</small>
    </div>

    <div
      class="power-rail"
      :class="{ disabled: !ui.canShoot, pulling: draggingPower }"
      title="上下拖动、滚轮或键盘 ↑/↓ 精确调节力度"
      @wheel.prevent="onPowerWheel"
    >
      <div class="power-head">
        <span class="power-tone">{{ powerTone }}</span>
        <output id="power-value">{{ powerPercent }}%</output>
      </div>
      <div class="power-presets" role="group" aria-label="快捷力度档位">
        <button
          v-for="preset in PRESETS"
          :key="preset.value"
          :class="{ active: Math.abs(powerPercent - preset.value) <= 3 }"
          :disabled="!ui.canShoot"
          @click="actions.setPower(preset.value)"
        >
          {{ preset.label }}
        </button>
      </div>
      <button
        class="power-step"
        aria-label="增加 1% 力度"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginPowerStep(1)"
        @pointerup="stopPowerStep"
        @pointercancel="stopPowerStep"
        @pointerleave="stopPowerStep"
      >
        ＋
      </button>
      <div
        ref="powerTrack"
        id="pw"
        class="power-track"
        role="slider"
        tabindex="0"
        aria-label="击球力度"
        aria-valuemin="1"
        aria-valuemax="100"
        :aria-valuenow="powerPercent"
        :aria-disabled="!ui.canShoot"
        @pointerdown.prevent="onPowerDown"
        @pointermove="onPowerMove"
        @pointerup="onPowerUp"
        @pointercancel="onPowerUp"
        @lostpointercapture="onPowerUp"
      >
        <div class="power-fill" :style="{ '--p': powerPercent + '%' }"></div>
        <div class="power-ticks" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="power-thumb" :style="{ '--p': powerPercent + '%' }"></div>
      </div>
      <button
        class="power-step"
        aria-label="减小 1% 力度"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginPowerStep(-1)"
        @pointerup="stopPowerStep"
        @pointercancel="stopPowerStep"
        @pointerleave="stopPowerStep"
      >
        −
      </button>
    </div>

    <div class="fn" title="精细微调瞄准角度（键盘 ← / →，按住 Shift 更细）">
      <button
        aria-label="向左微调瞄准"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginNudge(1)"
        @pointerup="stopNudge"
        @pointercancel="stopNudge"
        @pointerleave="stopNudge"
      >
        ←
      </button>
      <button
        aria-label="向右微调瞄准"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginNudge(-1)"
        @pointerup="stopNudge"
        @pointercancel="stopNudge"
        @pointerleave="stopNudge"
      >
        →
      </button>
    </div>

    <button
      id="go"
      data-fire="true"
      :disabled="!ui.canShoot"
      :title="hint"
      @click="actions.shoot"
    >
      击球
    </button>
  </aside>
</template>

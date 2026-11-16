<script setup>
import { onBeforeUnmount } from 'vue'
import SpinPad from './SpinPad.vue'
import { AIM_NUDGE } from '../game/constants.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

let timer = null
let held = 0

function nudge(direction, step) {
  props.actions.nudge(direction * step)
}

function beginNudge(direction) {
  if (!props.ui.canShoot) return
  stopNudge()
  held = 0
  nudge(direction, AIM_NUDGE)
  timer = setInterval(() => {
    // 单击保持精细；按住约半秒后逐步加速，方便大角度转向。
    const step = AIM_NUDGE * (1 + Math.min(held++, 12) * 0.1)
    nudge(direction, step)
  }, 40)
}

function stopNudge() {
  if (timer) clearInterval(timer)
  timer = null
}

onBeforeUnmount(stopNudge)
</script>

<template>
  <footer id="ctl" :inert="ui.menu.visible">
    <div class="spin-wrap">
      <SpinPad
        :spin="ui.spin"
        :disabled="!ui.canShoot"
        @update="actions.setSpin"
      />
      <small>旋转击点</small>
    </div>
    <div class="fn">
      <button
        aria-label="向左微调瞄准"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginNudge(1)"
        @pointerup="stopNudge"
        @pointercancel="stopNudge"
        @pointerleave="stopNudge"
      >
        ← 微调
      </button>
      <button
        aria-label="向右微调瞄准"
        :disabled="!ui.canShoot"
        @pointerdown.prevent="beginNudge(-1)"
        @pointerup="stopNudge"
        @pointercancel="stopNudge"
        @pointerleave="stopNudge"
      >
        微调 →
      </button>
      <span>方向键微调 · Shift+方向键更细 · 双击白球图复位击点</span>
    </div>
    <label class="pw">
      力度
      <input
        id="pw"
        type="range"
        min="1"
        max="100"
        :value="Math.round(ui.power * 100)"
        :disabled="!ui.canShoot"
        @input="actions.setPower(Number($event.target.value))"
      />
      <output id="power-value">{{ Math.round(ui.power * 100) }}%</output>
    </label>
    <button
      id="go"
      data-fire="true"
      :disabled="!ui.canShoot"
      @click="actions.shoot"
    >
      击球<small>按住 SPACE 蓄力</small>
    </button>
  </footer>
</template>

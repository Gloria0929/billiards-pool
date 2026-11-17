<script setup>
import { computed, onBeforeUnmount } from 'vue'
import SpinPad from './SpinPad.vue'
import { AIM_NUDGE } from '../game/constants.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

let timer = null
let held = 0
const finePointer = window.matchMedia('(pointer: fine)').matches
const spin = computed(() => props.ui.canShoot ? props.ui.spin : props.ui.playerSpin)
const powerPercent = computed(() =>
  Math.round((props.ui.canShoot ? props.ui.power : props.ui.playerPower) * 100),
)

const hint = computed(() => {
  let text =
    props.ui.view === 'top'
      ? '点击 / 拖动瞄准 · 自由球可拖动白球'
      : props.ui.view === 'orbit'
        ? '轻点瞄准 · 拖动环绕 · 滚轮 / 双指缩放'
        : '左右拖动瞄准 · 上下调高度 · 滚轮调远近'
  text += ' · 切球瞄准半透明幽灵球'
  if (finePointer) text += ' · 右键后拽 / 按住空格蓄力'
  return text
})

// 窄屏只保留最关键的一句，避免提示被截断成半句。
const shortHint = computed(() => {
  if (props.ui.view === 'top') return '点击拖动瞄准'
  if (props.ui.view === 'orbit') return '拖动环绕 · 双指缩放'
  return '拖动瞄准 · 高度可调'
})

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
        :spin="spin"
        :disabled="!ui.canShoot"
        @update="actions.setSpin"
      />
      <small>旋转击点</small>
    </div>
    <div class="ctl-main">
      <label class="pw">
        <span class="pw-label">力度</span>
        <input
          id="pw"
          type="range"
          min="1"
          max="100"
          :value="powerPercent"
          :style="{ '--p': powerPercent + '%' }"
          :disabled="!ui.canShoot"
          aria-label="击球力度"
          @input="actions.setPower(Number($event.target.value))"
        />
        <output id="power-value">{{ powerPercent }}%</output>
      </label>
      <div class="fn">
        <span class="fn-label">微调</span>
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
    </div>
    <button
      id="go"
      data-fire="true"
      :disabled="!ui.canShoot"
      @click="actions.shoot"
    >
      击球<small>按住 SPACE 蓄力</small>
    </button>
    <p class="ctl-hint" :title="hint"
      ><span class="hint-full">{{ hint }}</span
      ><span class="hint-compact">{{ shortHint }}</span></p
    >
  </footer>
</template>

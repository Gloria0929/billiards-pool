<script setup>
import { computed } from 'vue'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
  setCanvas: { type: Function, required: true },
})

const finePointer = window.matchMedia('(pointer: fine)').matches

const hint = computed(() => {
  let text =
    props.ui.view === 'top'
      ? '点击 / 拖动瞄准 · 自由球可拖动白球'
      : props.ui.view === 'orbit'
        ? '轻点瞄准 · 拖动环绕 · 滚轮 / 双指缩放'
        : '左右拖动瞄准 · 上下调高度 · 滚轮调远近'
  if (finePointer) text += ' · 右键后拽 / 按住空格蓄力'
  return text
})

const powerPercent = computed(() => Math.round(props.ui.power * 100))

const watching = computed(
  () =>
    props.ui.online.status === 'playing' &&
    props.ui.online.seat != null &&
    props.ui.online.seat !== props.ui.turn,
)

const turnNote = computed(() => {
  if (props.ui.online.status === 'idle') {
    if (props.ui.turn === 1 && props.ui.phase === 'aim' && props.ui.names)
      return '电脑正在瞄准…'
    return ''
  }
  if (props.ui.online.status !== 'playing') return ''
  if (props.ui.online.opponentLeft) return '对手已离开'
  if (props.ui.online.waiting) return '正在同步击球…'
  if (props.ui.online.seat === props.ui.turn && props.ui.phase === 'aim')
    return '轮到你了'
  const name =
    props.ui.names?.[1 - props.ui.online.seat] ||
    props.ui.online.players?.[1 - props.ui.online.seat]?.name ||
    '对手'
  return `正在观看 ${name} 瞄准…`
})
</script>

<template>
  <main id="wrap" :inert="ui.menu.visible">
    <canvas
      id="cv"
      aria-label="3D 台球桌，点击台面瞄准"
      :ref="(el) => { if (el) setCanvas(el) }"
    ></canvas>
    <div id="view-hint">{{ hint }}</div>
    <div v-if="turnNote" class="turn-note">{{ turnNote }}</div>
    <div id="pbar" v-if="ui.charging">
      <span>力度</span>
      <i><u :style="{ width: powerPercent + '%' }"></u></i>
      <b>{{ powerPercent }}%</b>
    </div>
    <div id="view-tools">
      <button
        aria-label="拉远视角"
        :disabled="ui.view === 'top' || watching"
        @click="actions.zoom(0.1)"
      >
        −
      </button>
      <button
        aria-label="拉近视角"
        :disabled="ui.view === 'top' || watching"
        @click="actions.zoom(-0.1)"
      >
        ＋
      </button>
      <button :disabled="watching" @click="actions.resetView">复位</button>
    </div>
  </main>
</template>

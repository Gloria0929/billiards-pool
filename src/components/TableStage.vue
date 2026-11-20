<script setup>
import { computed } from 'vue'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
  setCanvas: { type: Function, required: true },
})

const powerPercent = computed(() => Math.round(props.ui.power * 100))

const powerTone = computed(() => {
  const p = powerPercent.value
  if (p <= 25) return '轻推'
  if (p <= 55) return '走位'
  if (p <= 80) return '发力'
  return '强攻'
})

const watching = computed(
  () =>
    props.ui.online.status === 'playing' &&
    props.ui.online.seat != null &&
    props.ui.online.seat !== props.ui.turn,
)

</script>

<template>
  <main id="wrap" :class="`view-${ui.view}`" :inert="ui.menu.visible">
    <canvas
      id="cv"
      aria-label="3D 台球桌，点击台面瞄准"
      :ref="(el) => { if (el) setCanvas(el) }"
    ></canvas>
    <div id="pbar" v-if="ui.charging">
      <span class="pbar-tag">{{ powerTone }}</span>
      <i>
        <u :style="{ width: powerPercent + '%' }"></u>
        <em class="pbar-ticks" aria-hidden="true"><span></span><span></span><span></span></em>
      </i>
      <b>{{ powerPercent }}%</b>
    </div>
    <div id="view-tools">
      <button
        v-if="ui.view !== 'top'"
        class="peek-btn"
        title="按住临时俯瞰全局（快捷键 T）"
        :disabled="watching"
        @pointerdown.prevent="actions.setPeekTop(true)"
        @pointerup="actions.setPeekTop(false)"
        @pointercancel="actions.setPeekTop(false)"
        @pointerleave="actions.setPeekTop(false)"
      >
        俯瞰
      </button>
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

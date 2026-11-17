<script setup>
import { computed } from 'vue'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
  setCanvas: { type: Function, required: true },
})

const powerPercent = computed(() => Math.round(props.ui.power * 100))

const watching = computed(
  () =>
    props.ui.online.status === 'playing' &&
    props.ui.online.seat != null &&
    props.ui.online.seat !== props.ui.turn,
)

</script>

<template>
  <main id="wrap" :inert="ui.menu.visible">
    <canvas
      id="cv"
      aria-label="3D 台球桌，点击台面瞄准"
      :ref="(el) => { if (el) setCanvas(el) }"
    ></canvas>
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

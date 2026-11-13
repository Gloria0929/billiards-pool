<script setup>
import { useBilliards } from './composables/useBilliards.js'
import GameHud from './components/GameHud.vue'
import TableStage from './components/TableStage.vue'
import ControlBar from './components/ControlBar.vue'
import ModeMenu from './components/ModeMenu.vue'

const { canvasRef, ui, actions } = useBilliards()

const setCanvas = (el) => {
  if (el) canvasRef.value = el
}
</script>

<template>
  <GameHud :ui="ui" :actions="actions" />
  <TableStage :ui="ui" :actions="actions" :set-canvas="setCanvas" />
  <ControlBar :ui="ui" :actions="actions" />
  <ModeMenu :ui="ui" :actions="actions" />
  <div id="load-error" v-if="ui.webglError">
    <h2>球桌暂时无法显示</h2>
    <p>请使用支持 WebGL 的浏览器，并开启硬件加速。</p>
  </div>
</template>

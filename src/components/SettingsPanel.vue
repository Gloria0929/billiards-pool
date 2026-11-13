<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

const root = ref(null)
const guideLocked = computed(
  () =>
    props.ui.online.status === 'room' || props.ui.online.status === 'playing',
)
const volumePercent = computed(() => Math.round(props.ui.audio.volume * 100))

function onDocumentPointerDown(event) {
  if (root.value?.contains(event.target)) return
  if (document.getElementById('settings-toggle')?.contains(event.target)) return
  props.actions.closeSettings()
}

function onKeyDown(event) {
  if (event.key === 'Escape') props.actions.closeSettings()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <aside
    id="settings-panel"
    ref="root"
    class="settings-panel"
    aria-label="游戏设置"
  >
    <h4>设置</h4>
    <div class="setting-row">
      <div class="setting-text">
        <b>辅助线</b>
        <small>{{
          guideLocked ? '本局由房主设置' : '显示预测线、翻袋线与进袋提示'
        }}</small>
      </div>
      <button
        class="setting-switch"
        :aria-pressed="ui.showGuide"
        :disabled="guideLocked"
        @click="actions.toggleGuide"
      >
        {{ ui.showGuide ? '开' : '关' }}
      </button>
    </div>
    <div class="setting-row">
      <div class="setting-text">
        <b>音效</b>
        <small>击球、碰撞与入袋实录音效</small>
      </div>
      <button
        class="setting-switch"
        :aria-pressed="!ui.audio.muted"
        :disabled="ui.audio.unavailable"
        @click="actions.toggleMute"
      >
        {{ ui.audio.unavailable ? '不可用' : ui.audio.muted ? '关' : '开' }}
      </button>
    </div>
    <label class="setting-volume">
      音量
      <input
        type="range"
        min="0"
        max="100"
        :value="volumePercent"
        aria-label="音量"
        @input="actions.setVolume(Number($event.target.value))"
      />
      <output>{{ volumePercent }}%</output>
    </label>
    <button class="setting-preview" @click="actions.previewSound">
      试听击球
    </button>
    <p class="audio-credit">
      实录音效 · 光厂<br />限个人非商业学习、研究与交流
    </p>
  </aside>
</template>

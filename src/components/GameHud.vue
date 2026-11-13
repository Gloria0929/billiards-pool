<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PlayerCard from './PlayerCard.vue'
import SettingsPanel from './SettingsPanel.vue'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

const onlineOpen = ref(false)
const popEl = ref(null)
const triggerEl = ref(null)

const onlineActive = computed(
  () => props.ui.online.status === 'room' || props.ui.online.status === 'playing',
)
const watching = computed(
  () =>
    props.ui.online.status === 'playing' &&
    props.ui.online.seat != null &&
    props.ui.online.seat !== props.ui.turn,
)

const views = [
  { id: 'top', label: '俯视' },
  { id: 'orbit', label: '3D 全景' },
  { id: 'fp', label: '贴杆瞄准' },
]

function displayName(seat) {
  return (
    props.ui.names?.[seat] ||
    props.ui.online.players?.[seat]?.name ||
    `玩家${seat + 1}`
  )
}

function tagFor(seat) {
  if (!onlineActive.value) return ''
  return seat === props.ui.online.seat ? '你' : '对手'
}

function toggleOnline() {
  props.actions.closeSettings()
  onlineOpen.value = !onlineOpen.value
}

function toggleSettings() {
  onlineOpen.value = false
  props.actions.toggleSettings()
}

function leaveRoom() {
  onlineOpen.value = false
  props.actions.leaveRoom()
}

function onDocumentPointerDown(event) {
  if (!onlineOpen.value) return
  if (popEl.value?.contains(event.target)) return
  if (triggerEl.value?.contains(event.target)) return
  onlineOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <header id="hud" :inert="ui.menu.visible">
    <div class="brand">
      <span class="brand-mark">8</span>
      <div>
        <div class="brand-name">真实台球</div>
        <small id="mode-label">{{ ui.modeLabel }}</small>
      </div>
    </div>
    <PlayerCard
      v-for="seat in [0, 1]"
      :key="seat"
      :seat="seat"
      :label="displayName(seat)"
      :tag="tagFor(seat)"
      :active="ui.phase !== 'over' && ui.turn === seat"
      :mode="ui.mode"
      :group="ui.groups[seat]"
      :score="ui.scores[seat]"
      :balls="ui.balls"
    />
    <div class="hud-actions">
      <nav class="viewbar viewbar-inline" aria-label="选择视角">
        <button
          v-for="item in views"
          :key="item.id"
          :data-view="item.id"
          :aria-pressed="ui.view === item.id"
          :disabled="watching"
          :title="watching ? '正在观看对手视角' : ''"
          @click="actions.setView(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
      <button
        id="settings-toggle"
        :aria-expanded="ui.settingsOpen"
        aria-controls="settings-panel"
        @click="toggleSettings"
      >
        设置
      </button>
      <button v-if="onlineActive" ref="triggerEl" @click="toggleOnline">
        联机
      </button>
      <button v-else id="nb" @click="actions.openMenu">切换玩法</button>
      <SettingsPanel v-if="ui.settingsOpen" :ui="ui" :actions="actions" />
    </div>
    <div id="msg" role="status" aria-live="polite">{{ ui.message }}</div>
    <div v-if="onlineOpen" ref="popEl" class="online-pop">
      <h4>联机房间</h4>
      <p>
        房间码 <span class="code">{{ ui.online.code }}</span>
      </p>
      <p>
        你是{{ ui.online.seat === 0 ? '房主' : '挑战者' }} ·
        对手：{{ displayName(1 - ui.online.seat) }}
      </p>
      <p>辅助线：{{ ui.online.guide ? '开' : '关' }}</p>
      <button @click="leaveRoom">离开房间</button>
    </div>
  </header>
</template>

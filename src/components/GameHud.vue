<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PlayerCard from './PlayerCard.vue'
import SettingsPanel from './SettingsPanel.vue'
import { formatLabel } from '../game/series.js'

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

const colorNames = ['黄', '绿', '棕', '蓝', '粉', '黑']

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
  if (onlineActive.value)
    return seat === props.ui.online.seat ? '你' : '对手'
  if (seat === 1 && props.ui.names) return 'AI'
  return ''
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
    <div
      v-if="ui.mode === 'snk' && ui.phase !== 'over'"
      class="hud-remaining"
      title="台面理论最高可得分数：每颗红球按红+黑计，彩球按面值计"
    >
      <small>台面最高分</small>
      <b>{{ ui.snookerRemaining }}</b>
    </div>
    <div
      v-if="ui.match && ui.match.bestOf > 1"
      class="hud-match"
      :title="formatLabel(ui.match.bestOf)"
    >
      <small>第 {{ ui.match.frame }} 局</small>
      <b>{{ ui.match.wins[0] }} : {{ ui.match.wins[1] }}</b>
    </div>
    <div class="hud-actions">
      <select
        v-if="ui.canNominate"
        class="color-nomination"
        aria-label="指定目标彩球"
        :value="ui.nominatedColor ?? ''"
        @change="actions.nominateColor(Number($event.target.value))"
      >
        <option value="" disabled>指定彩球</option>
        <template v-for="ball in ui.balls" :key="ball.n">
          <option v-if="ball.on && ball.n >= 16" :value="ball.n">
            {{ colorNames[ball.n - 16] }}球
          </option>
        </template>
      </select>
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
      <button v-if="ui.canRequestStalemate" @click="actions.requestStalemate">重摆</button>
      <button
        v-if="ui.mode === 'snk' && ui.phase !== 'over'"
        id="concede"
        :disabled="!ui.canConcede"
        :title="
          ui.canConcede
            ? '本局认输'
            : '轮到你击球且台面剩余分数不足以追平时才能认输'
        "
        @click="actions.openConcedeConfirm"
      >
        认输
      </button>
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

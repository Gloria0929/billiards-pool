<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { MODES } from '../game/constants.js'
import { formatLabel } from '../game/series.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})
const emit = defineEmits(['create'])

let timer = null

onMounted(() => {
  props.actions.requestRooms()
  timer = setInterval(() => props.actions.requestRooms(), 3000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  timer = null
})

const name = computed({
  get: () => props.ui.online.name,
  set: (value) => props.actions.setName(value),
})
const nameReady = computed(() => name.value.trim().length > 0)
const connecting = computed(() => props.ui.online.status === 'connecting')
const rooms = computed(() => props.ui.online.rooms || [])
const modeNameFor = (mode) => MODES[mode]?.name || '中式八球'

function join(room) {
  if (!nameReady.value) return
  props.actions.joinRoom(room.code)
}
</script>

<template>
  <div class="game-lobby">
    <div class="lobby-head">
      <div>
        <h2>游戏大厅</h2>
        <p>公开房间 · 申请后由房主同意加入</p>
      </div>
      <span
        class="online-state"
        :class="{ on: ui.online.connected }"
      >
        <i></i>{{ connecting ? '连接中' : ui.online.connected ? '已连接' : '未连接' }}
      </span>
    </div>

    <template v-if="ui.online.status === 'requesting'">
      <div class="lobby-empty lobby-waiting">
        <h3>等待房主同意</h3>
        <p>已向 {{ ui.online.code }} 房间发送加入申请。</p>
        <button @click="actions.cancelJoinRequest">取消申请</button>
      </div>
    </template>

    <template v-else>
      <div class="online-name lobby-name">
        <label for="lobby-nickname">你的昵称</label>
        <input
          id="lobby-nickname"
          v-model="name"
          maxlength="12"
          placeholder="申请加入前先填个昵称"
          autocomplete="off"
        />
      </div>

      <div v-if="rooms.length" class="lobby-grid">
        <article v-for="room in rooms" :key="room.code" class="lobby-card">
          <span class="lobby-mode">{{ modeNameFor(room.mode) }}</span>
          <h3>{{ room.host }}</h3>
          <p>
            {{ formatLabel(room.bestOf) }} · 辅助线{{ room.guide ? '开' : '关' }}
          </p>
          <div class="lobby-foot">
            <span>1 / 2 人</span>
            <button
              :disabled="connecting || !nameReady"
              @click="join(room)"
            >
              申请加入
            </button>
          </div>
        </article>
      </div>
      <div v-else class="lobby-empty">
        <p>{{ connecting ? '正在连接大厅…' : '还没有公开房间。' }}</p>
        <button @click="emit('create')">开一个公开房</button>
      </div>
    </template>

    <p v-if="ui.online.error" class="online-error">{{ ui.online.error }}</p>
  </div>
</template>

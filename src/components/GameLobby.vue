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
  <div>
    <p class="connection-state" :class="{ connected: ui.online.connected }" role="status">
      {{ connecting ? '连接中' : ui.online.connected ? '已连接' : '未连接' }}
    </p>

    <div v-if="ui.online.status === 'requesting'" class="front-empty">
      <h2>等待房主同意</h2>
      <p>已向 {{ ui.online.code }} 房间发送加入申请。</p>
      <button @click="actions.cancelJoinRequest">取消申请</button>
    </div>

    <template v-else>
      <div class="front-field nickname-field">
        <label for="lobby-nickname">你的昵称</label>
        <input
          id="lobby-nickname"
          v-model="name"
          maxlength="12"
          placeholder="输入昵称后可申请加入"
          autocomplete="off"
        />
      </div>

      <section v-if="rooms.length" aria-label="公开房间">
        <h2 class="lobby-list-title">公开房间 <span>{{ rooms.length }}</span></h2>
        <article v-for="room in rooms" :key="room.code" class="lobby-room">
          <div class="lobby-room-info">
            <h3>{{ room.host }}</h3>
            <p>
              {{ modeNameFor(room.mode) }} · {{ formatLabel(room.bestOf) }} ·
              辅助线{{ room.guide ? '开' : '关' }}
            </p>
          </div>
          <span class="lobby-occupancy">1 / 2 人</span>
          <button :disabled="connecting || !nameReady" @click="join(room)">
            申请加入
          </button>
        </article>
      </section>
      <div v-else class="front-empty">
        <h2>{{ connecting ? '正在连接大厅…' : '暂无公开房间' }}</h2>
        <button v-if="!connecting" class="front-primary" @click="emit('create')">
          创建公开房间 <span aria-hidden="true">↗</span>
        </button>
      </div>
    </template>

    <p v-if="ui.online.error" class="online-error" role="alert">{{ ui.online.error }}</p>
  </div>
</template>

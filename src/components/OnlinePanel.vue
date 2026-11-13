<script setup>
import { computed, ref } from 'vue'
import { MODES } from '../game/constants.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

const code = ref('')
const copied = ref(false)

const name = computed({
  get: () => props.ui.online.name,
  set: (value) => props.actions.setName(value),
})

const connecting = computed(() => props.ui.online.status === 'connecting')
const modeName = computed(
  () => MODES[props.ui.selectedMode]?.name || '中式八球',
)
const bothConnected = computed(
  () => props.ui.online.players.filter((player) => player.connected).length === 2,
)
const nameReady = computed(() => name.value.trim().length > 0)
const canJoin = computed(
  () => nameReady.value && code.value.trim().length >= 4,
)

function create() {
  if (!nameReady.value) return
  props.actions.createRoom()
}

function join() {
  if (!canJoin.value) return
  props.actions.joinRoom(code.value)
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.ui.online.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch (_) {}
}

const statusText = computed(() => {
  if (connecting.value) return '连接中'
  if (props.ui.online.status === 'room') return '房间已就绪'
  return '未连接'
})
</script>

<template>
  <div class="online-panel">
    <div class="online-head">
      <span class="online-title">联网对战</span>
      <span
        class="online-state"
        :class="{ on: ui.online.status === 'room' }"
      >
        <i></i>{{ statusText }}
      </span>
    </div>

    <template v-if="ui.online.status === 'room'">
      <div class="room-card">
        <span class="room-caption">房间码</span>
        <div class="room-code">{{ ui.online.code }}</div>
        <button class="copy-code" @click="copyCode">
          {{ copied ? '已复制' : '复制房间码' }}
        </button>
        <div class="room-note">
          把房间码发给朋友，他在「联机对战」里输入即可加入。
        </div>
        <div class="room-setting">
          本局玩法 <b>{{ modeName }}</b> · 辅助线
          <b>{{ ui.online.guide ? '开启' : '关闭' }}</b>
        </div>
      </div>
      <div class="seats">
        <div
          v-for="player in ui.online.players"
          :key="player.seat"
          class="seat"
          :class="{ you: player.seat === ui.online.seat }"
        >
          <span class="seat-name">
            {{ player.name || '等待加入…' }}
            <em v-if="player.seat === ui.online.seat" class="pl-tag">你</em>
          </span>
          <span class="meta">
            {{ player.connected ? (player.seat === 0 ? '房主' : '对手') : '空位' }}
          </span>
        </div>
      </div>
      <div class="room-actions">
        <button
          v-if="ui.online.seat === 0"
          id="start-online"
          :disabled="!bothConnected"
          @click="actions.startOnline"
        >
          开始比赛 →
        </button>
        <span v-else-if="bothConnected" class="status-line">
          等待房主开始…
        </span>
        <span v-else class="status-line">等待另一位玩家加入…</span>
        <button @click="actions.leaveRoom">离开房间</button>
      </div>
    </template>

    <template v-else>
      <div class="online-name">
        <label for="online-nickname">你的昵称</label>
        <input
          id="online-nickname"
          v-model="name"
          maxlength="12"
          placeholder="对手会看到这个昵称"
          autocomplete="off"
        />
      </div>
      <div class="online-grid">
        <div class="online-card">
          <h3>创建房间</h3>
          <p>以「{{ modeName }}」开一桌，等朋友加入。</p>
          <div class="mode-pick">
            <span>玩法</span>
            <div class="mode-pick-btns">
              <button
                :aria-pressed="ui.selectedMode === 'pool'"
                @click="actions.selectMode('pool')"
              >
                中式八球
              </button>
              <button
                :aria-pressed="ui.selectedMode === 'snk'"
                @click="actions.selectMode('snk')"
              >
                斯诺克
              </button>
            </div>
          </div>
          <div class="guide-option">
            <span>辅助线</span>
            <button
              :aria-pressed="ui.online.guide"
              @click="actions.setRoomGuide(!ui.online.guide)"
            >
              {{ ui.online.guide ? '开启' : '关闭' }}
            </button>
          </div>
          <div class="online-field">
            <button
              class="online-submit"
              :disabled="connecting || !nameReady"
              @click="create"
            >
              创建房间
            </button>
          </div>
        </div>
        <div class="online-card">
          <h3>加入房间</h3>
          <p>输入朋友发来的 5 位房间码。</p>
          <div class="online-field">
            <input
              id="room-code"
              v-model="code"
              maxlength="6"
              placeholder="ABCDE"
              autocomplete="off"
              @keyup.enter="join"
            />
            <button :disabled="connecting || !canJoin" @click="join">
              加入
            </button>
          </div>
        </div>
      </div>
      <p v-if="connecting" class="status-line">正在连接联机服务器…</p>
    </template>

    <p v-if="ui.online.error" class="online-error">{{ ui.online.error }}</p>
  </div>
</template>

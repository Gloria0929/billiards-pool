<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MODES } from '../game/constants.js'
import { MATCH_FORMATS, formatLabel } from '../game/series.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

const emit = defineEmits(['browse'])

const code = ref('')
const copied = ref(false)
let copyTimer = null
onMounted(() => props.actions.requestRooms())
onBeforeUnmount(() => clearTimeout(copyTimer))

const name = computed({
  get: () => props.ui.online.name,
  set: (value) => props.actions.setName(value),
})

const connecting = computed(() => props.ui.online.status === 'connecting')
const requesting = computed(() => props.ui.online.status === 'requesting')
const inRoom = computed(
  () =>
    props.ui.online.status === 'room' ||
    props.ui.online.status === 'playing',
)
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
const statusText = computed(() => {
  if (connecting.value) return '连接中'
  if (requesting.value) return '等待房主'
  if (inRoom.value) return bothConnected.value ? '双方已就位' : '等待球员'
  if (props.ui.online.connected) return '大厅已连接'
  return '未连接'
})

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
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 1600)
  } catch (_) {}
}
</script>

<template>
  <div>
    <p class="connection-state" :class="{ connected: ui.online.connected }" role="status">
      {{ statusText }}
    </p>

    <template v-if="requesting">
      <div class="front-empty">
        <h2>等待房主同意</h2>
        <p>已向 {{ ui.online.code }} 房间发送加入申请。</p>
        <button @click="actions.cancelJoinRequest">取消申请</button>
      </div>
    </template>

    <template v-else-if="inRoom">
      <section class="room-pass" aria-label="房间邀请">
        <div class="room-pass-main">
          <div>
            <span>{{ ui.online.visibility === 'public' ? '公开房间码' : '私有房间码' }}</span>
            <strong>{{ ui.online.code }}</strong>
          </div>
          <button @click="copyCode">{{ copied ? '已复制' : '复制房间码' }}</button>
        </div>
        <div class="room-pass-details">
          <span>{{ modeName }}</span>
          <span>{{ formatLabel(ui.match.bestOf) }}</span>
          <span>辅助线{{ ui.online.guide ? '开' : '关' }}</span>
        </div>
      </section>

      <div
        v-if="ui.online.seat === 0 && ui.online.requests.length"
        class="join-requests"
      >
        <h4>加入申请</h4>
        <div
          v-for="request in ui.online.requests"
          :key="request.id"
          class="join-request"
        >
          <span class="join-name">{{ request.name }} 申请加入</span>
          <div class="join-actions">
            <button @click="actions.respondJoinRequest(request.id, true)">
              同意
            </button>
            <button @click="actions.respondJoinRequest(request.id, false)">
              拒绝
            </button>
          </div>
        </div>
      </div>

      <h2 class="roster-heading">球员</h2>
      <div class="seats">
        <div
          v-for="player in ui.online.players"
          :key="player.seat"
          class="seat"
          :class="{ you: player.seat === ui.online.seat }"
        >
          <span class="seat-avatar" aria-hidden="true">{{ player.name?.trim()[0] || '＋' }}</span>
          <span class="seat-name">
            {{ player.name || '等待加入' }}
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
          class="front-primary"
          :disabled="!bothConnected"
          @click="actions.startOnline"
        >
          开始比赛
        </button>
        <span v-else-if="bothConnected" class="status-line">
          等待房主开始…
        </span>
        <span v-else class="status-line">等待另一位玩家加入…</span>
        <button @click="actions.leaveRoom">离开房间</button>
      </div>
    </template>

    <template v-else>
      <div class="front-field nickname-field">
        <label for="online-nickname">你的昵称</label>
        <input
          id="online-nickname"
          v-model="name"
          maxlength="12"
          placeholder="输入昵称"
          autocomplete="off"
        />
      </div>

      <div class="online-setup">
        <section class="create-room">
          <h2>创建房间</h2>
          <div class="online-option">
            <span class="field-label">玩法</span>
            <div class="front-segments" role="group" aria-label="玩法">
              <button :aria-pressed="ui.selectedMode === 'pool'" @click="actions.selectMode('pool')">
                中式八球
              </button>
              <button :aria-pressed="ui.selectedMode === 'snk'" @click="actions.selectMode('snk')">
                斯诺克
              </button>
            </div>
          </div>
          <div class="online-option">
            <span class="field-label">房间类型</span>
            <div class="front-segments" role="group" aria-label="房间类型">
              <button :aria-pressed="ui.online.visibility === 'public'" @click="actions.setRoomVisibility('public')">
                公开
              </button>
              <button :aria-pressed="ui.online.visibility === 'private'" @click="actions.setRoomVisibility('private')">
                私有
              </button>
            </div>
          </div>
          <div class="online-option">
            <span class="field-label">辅助线</span>
            <div class="front-segments">
              <button :aria-pressed="ui.online.guide" @click="actions.setRoomGuide(!ui.online.guide)">
                {{ ui.online.guide ? '开启' : '关闭' }}
              </button>
            </div>
          </div>
          <div class="online-option online-format">
            <span class="field-label">赛制</span>
            <div class="front-segments" role="group" aria-label="赛制">
              <button
                v-for="format in MATCH_FORMATS"
                :key="format"
                :aria-pressed="ui.bestOf === format"
                @click="actions.setBestOf(format)"
              >
                {{ formatLabel(format) }}
              </button>
            </div>
          </div>
          <button class="front-primary" :disabled="connecting || !nameReady" @click="create">
            创建房间 <span aria-hidden="true">↗</span>
          </button>
        </section>

        <form class="join-room" @submit.prevent="join">
          <h2>加入房间</h2>
          <div class="front-field">
            <label for="room-code">房间码</label>
            <input
              id="room-code"
              v-model="code"
              maxlength="6"
              placeholder="输入房间码"
              autocomplete="off"
              autocapitalize="characters"
            />
          </div>
          <button :disabled="connecting || !canJoin" type="submit">加入房间</button>
          <button class="front-text-button" type="button" @click="emit('browse')">
            查看公开房间 <span aria-hidden="true">→</span>
          </button>
        </form>
      </div>
    </template>

    <p v-if="ui.online.error" class="online-error" role="alert">{{ ui.online.error }}</p>
  </div>
</template>

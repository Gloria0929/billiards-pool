<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MODES } from '../game/constants.js'
import { MATCH_FORMATS, formatLabel } from '../game/series.js'

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
})

const code = ref('')
const copied = ref(false)
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
  if (inRoom.value) return '房间已就绪'
  if (props.ui.online.connected) return '大厅已连接'
  return '未连接'
})

const modeNameFor = (mode) => MODES[mode]?.name || '中式八球'

function create() {
  if (!nameReady.value) return
  props.actions.createRoom()
}

function join() {
  if (!canJoin.value) return
  props.actions.joinRoom(code.value)
}

function requestJoin(roomCode) {
  if (!nameReady.value) return
  props.actions.joinRoom(roomCode)
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.ui.online.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch (_) {}
}
</script>

<template>
  <div class="online-panel">
    <div class="online-head">
      <span class="online-title">联网对战</span>
      <span
        class="online-state"
        :class="{ on: inRoom || ui.online.connected }"
      >
        <i></i>{{ statusText }}
      </span>
    </div>

    <template v-if="requesting">
      <div class="room-card waiting-card">
        <span class="room-caption">等待房主同意</span>
        <div class="room-code">{{ ui.online.code }}</div>
        <div class="room-note">
          已发送加入申请，房主同意后就会进入房间。
        </div>
        <div class="room-actions">
          <button @click="actions.cancelJoinRequest">取消申请</button>
        </div>
      </div>
    </template>

    <template v-else-if="inRoom">
      <div class="room-card">
        <span class="room-caption">
          {{ ui.online.visibility === 'public' ? '公开房间' : '私有房间' }}
        </span>
        <div class="room-code">{{ ui.online.code }}</div>
        <button class="copy-code" @click="copyCode">
          {{ copied ? '已复制' : '复制房间码' }}
        </button>
        <div class="room-note">
          {{
            ui.online.visibility === 'public'
              ? '房间已出现在大厅，其他玩家申请加入后需要你同意。'
              : '私有房间不会出现在大厅，把房间码发给朋友即可加入。'
          }}
        </div>
        <div class="room-setting">
          本局玩法 <b>{{ modeName }}</b> ·
          <b>{{ formatLabel(ui.match.bestOf) }}</b> · 辅助线
          <b>{{ ui.online.guide ? '开启' : '关闭' }}</b>
        </div>
      </div>

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
          <p>
            以「{{ modeName }}」开一桌{{
              ui.online.visibility === 'public'
                ? '，公开房需要你同意加入申请。'
                : '，私有房凭房间码加入。'
            }}
          </p>
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
            <span>房间类型</span>
            <button
              :aria-pressed="ui.online.visibility === 'public'"
              @click="actions.setRoomVisibility('public')"
            >
              公开
            </button>
            <button
              :aria-pressed="ui.online.visibility === 'private'"
              @click="actions.setRoomVisibility('private')"
            >
              私有
            </button>
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
          <div class="guide-option format-option">
            <span>赛制</span>
            <button
              v-for="format in MATCH_FORMATS"
              :key="format"
              :aria-pressed="ui.bestOf === format"
              @click="actions.setBestOf(format)"
            >
              {{ formatLabel(format) }}
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
          <p>输入朋友发来的 5 位房间码；公开房需要房主同意。</p>
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

      <div class="online-card public-rooms">
        <h3>公开房间</h3>
        <div v-if="ui.online.rooms.length" class="room-list">
          <div
            v-for="room in ui.online.rooms"
            :key="room.code"
            class="room-item"
          >
            <div class="room-info">
              <b>{{ room.host }}</b>
              <span>
                {{ modeNameFor(room.mode) }} · {{ formatLabel(room.bestOf) }} ·
                辅助线{{ room.guide ? '开' : '关' }}
              </span>
            </div>
            <button
              :disabled="connecting || !nameReady"
              @click="requestJoin(room.code)"
            >
              申请加入
            </button>
          </div>
        </div>
        <p v-else class="status-line">
          暂无公开房间，创建一个等球友来吧。
        </p>
      </div>

      <p v-if="connecting" class="status-line">正在连接联机服务器…</p>
    </template>

    <p v-if="ui.online.error" class="online-error">{{ ui.online.error }}</p>
  </div>
</template>

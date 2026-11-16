<script setup>
import { computed, ref } from "vue";
import OnlinePanel from "./OnlinePanel.vue";
import GameLobby from "./GameLobby.vue";
import { MATCH_FORMATS, formatLabel } from "../game/series.js";

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const tab = ref("local");

const difficultyNote = computed(
  () =>
    ({
      easy: "简单：瞄准误差较大，偶尔随意选球，适合熟悉手感。",
      normal: "普通：稳定发挥，会挑最近的可进球。",
      hard: "困难：进球率高，会用加塞和高低杆控制白球走位。",
    })[props.ui.aiDifficulty] || "",
);

const SNK_NAMES = ["黄", "绿", "棕", "蓝", "粉", "黑"];
const freeBallColors = computed(() => {
  const seqColor =
    !props.ui.snookerOnRed && !props.ui.snookerFinalColor
      ? 16 + props.ui.snookerColorIndex
      : null
  return props.ui.balls
    .filter((ball) => ball.on && ball.n >= 16 && ball.n !== seqColor)
    .map((ball) => ({ n: ball.n, label: SNK_NAMES[ball.n - 16] }))
});

const summary = computed(() => {
  const base =
    props.ui.selectedMode === "pool"
      ? "已选中式八球 · 清完本组，再打黑八"
      : "已选斯诺克 · 红彩交替，累计得分";
  return props.ui.bestOf > 1 ? `${base} · ${formatLabel(props.ui.bestOf)}` : base;
});
const startLabel = computed(() =>
  props.ui.selectedMode === "pool" ? "开始游戏 →" : "开始游戏 →",
);
const showModes = computed(() =>
  ["start", "paused"].includes(props.ui.menu.kind),
);
const meReady = computed(
  () =>
    props.ui.online.seat != null &&
    props.ui.online.rematch?.[props.ui.online.seat],
);
const opponentReady = computed(
  () =>
    props.ui.online.seat != null &&
    props.ui.online.rematch?.[1 - props.ui.online.seat],
);
const rematchText = computed(() => {
  if (meReady.value) return "已准备，等待对手…";
  if (opponentReady.value) return "对手已经准备好，就等你了。";
  if ((props.ui.match?.bestOf || 1) === 1)
    return "双方都点击「再来一局」后，会重新摆球开始新一局。";
  if (props.ui.match?.over) return "双方都点击「再来一场」后，开始新一场比赛。";
  return "双方都点击「下一局」后，进入下一局。";
});
const replayLabel = computed(() => {
  if (meReady.value) return "已准备，等待对手";
  if ((props.ui.match?.bestOf || 1) === 1) return "再来一局";
  if (props.ui.match?.over) return "再来一场";
  return "下一局";
});
const localReplayLabel = computed(() => {
  if ((props.ui.match?.bestOf || 1) === 1) return "再来一局";
  if (props.ui.match?.over) return "再来一场";
  return "下一局";
});
const panelTitle = computed(() => {
  if (props.ui.menu.kind !== "start") return props.ui.menu.title;
  if (tab.value === "lobby") return "球友在大厅等你。";
  if (tab.value === "online") return "开一桌，或加入朋友。";
  return props.ui.menu.title;
});
const panelIntro = computed(() => {
  if (props.ui.menu.kind !== "start") return props.ui.menu.intro;
  if (tab.value === "lobby")
    return "浏览公开房间，选一桌申请加入；房主同意后即可开局。";
  if (tab.value === "online")
    return "创建公开或私有房间，也可以输入朋友发来的房间码。";
  return props.ui.menu.intro;
});
function openOnlineFromLobby() {
  props.actions.setRoomVisibility("public");
  tab.value = "online";
}
</script>

<template>
  <div
    id="ov"
    v-if="ui.menu.visible"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ovt"
  >
    <section class="mode-panel">
      <p class="eyebrow">THE BILLIARDS ROOM</p>
      <h1 id="ovt">{{ panelTitle }}</h1>
      <p class="intro">{{ panelIntro }}</p>

      <template v-if="showModes">
        <div class="mode-tabs" role="tablist" aria-label="对局方式">
          <button
            role="tab"
            :aria-pressed="tab === 'local'"
            @click="tab = 'local'"
          >
            人机对战
          </button>
          <button
            role="tab"
            :aria-pressed="tab === 'lobby'"
            @click="tab = 'lobby'"
          >
            游戏大厅
          </button>
          <button
            role="tab"
            :aria-pressed="tab === 'online'"
            @click="tab = 'online'"
          >
            联网对战
          </button>
        </div>

        <template v-if="tab === 'local'">
          <div class="mode-options" aria-label="选择玩法">
            <button
              class="mode-card"
              id="m1"
              :aria-pressed="ui.selectedMode === 'pool'"
              @click="actions.selectMode('pool')"
            >
              <span class="selected-mark" aria-hidden="true">✓</span>
              <span class="mode-art" aria-hidden="true">
                <span class="eight-ball"><span>8</span></span>
              </span>
              <strong>中式八球</strong>
              <span class="en">CHINESE EIGHT-BALL</span>
              <p>全色与花色，各有所属。<br />清完本组球，再将 8 号球打进。</p>
              <span class="mode-meta">16 颗球 · 分组对抗 · 节奏明快</span>
            </button>
            <button
              class="mode-card"
              id="m2"
              :aria-pressed="ui.selectedMode === 'snk'"
              @click="actions.selectMode('snk')"
            >
              <span class="selected-mark" aria-hidden="true">✓</span>
              <span class="mode-art" aria-hidden="true">
                <svg viewBox="0 0 140 110">
                  <defs>
                    <radialGradient id="red" cx="30%" cy="20%">
                      <stop stop-color="#e07b6b" />
                      <stop offset=".4" stop-color="#ae342e" />
                      <stop offset="1" stop-color="#571c1a" />
                    </radialGradient>
                  </defs>
                  <g fill="url(#red)">
                    <circle cx="70" cy="20" r="16" />
                    <circle cx="52" cy="51" r="16" />
                    <circle cx="88" cy="51" r="16" />
                    <circle cx="34" cy="82" r="16" />
                    <circle cx="70" cy="82" r="16" />
                    <circle cx="106" cy="82" r="16" />
                  </g>
                </svg>
              </span>
              <strong>斯诺克</strong>
              <span class="en">SNOOKER</span>
              <p>红球与彩球交替得分。<br />更大的球台，更细腻的走位。</p>
              <span class="mode-meta">22 颗球 · 积分较量 · 精准控球</span>
            </button>
          </div>
          <div class="setup-card">
            <div class="setup-top">
              <div class="difficulty-row" aria-label="电脑难度">
                <span class="setup-label">电脑难度</span>
                <div class="difficulty-options">
                  <button
                    id="diff-easy"
                    :aria-pressed="ui.aiDifficulty === 'easy'"
                    @click="actions.setAiDifficulty('easy')"
                  >
                    简单
                  </button>
                  <button
                    id="diff-normal"
                    :aria-pressed="ui.aiDifficulty === 'normal'"
                    @click="actions.setAiDifficulty('normal')"
                  >
                    普通
                  </button>
                  <button
                    id="diff-hard"
                    :aria-pressed="ui.aiDifficulty === 'hard'"
                    @click="actions.setAiDifficulty('hard')"
                  >
                    困难
                  </button>
                </div>
              </div>
              <div class="difficulty-row" aria-label="赛制">
                <span class="setup-label">赛制</span>
                <div class="difficulty-options">
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
            </div>
            <p class="difficulty-note">{{ difficultyNote }}</p>
          </div>
          <div class="mode-footer">
            <p>
              <span id="mode-summary">{{ summary }}</span
              ><br /><span class="footer-hint"
                >你与电脑轮流击球 · 支持鼠标与触屏</span
              >
            </p>
            <button id="start" @click="actions.startLocal">
              {{ startLabel }}
            </button>
          </div>
          <button
            v-if="ui.menu.kind === 'paused'"
            id="resume"
            @click="actions.resumeGame"
          >
            返回当前对局
          </button>
        </template>

        <GameLobby
          v-else-if="tab === 'lobby'"
          :ui="ui"
          :actions="actions"
          @create="openOnlineFromLobby"
        />

        <OnlinePanel v-else :ui="ui" :actions="actions" />
      </template>

      <template v-else-if="ui.menu.kind === 'break-choice'">
        <div v-if="ui.menu.mine" class="room-actions">
          <button
            v-if="ui.menu.breakKind !== 'no-contact'"
            id="break-accept"
            @click="actions.resolveBreakChoice('accept')"
          >
            {{ ui.menu.breakKind === 'foul' ? '线后自由球' : ui.menu.breakKind === 'eight' ? '复位黑八并续打' : '接受台面' }}
          </button>
          <button
            id="break-self"
            @click="actions.resolveBreakChoice('rerack', 'self')"
          >
            我重新开球
          </button>
          <button
            v-if="ui.menu.breakKind !== 'eight'"
            id="break-offender"
            @click="actions.resolveBreakChoice('rerack', 'offender')"
          >
            让对方重开
          </button>
        </div>
        <p v-else class="rematch-note">等待对手选择…</p>
      </template>

      <template v-else-if="ui.menu.kind === 'foul-choice'">
        <div v-if="ui.menu.mine" class="room-actions">
          <button id="foul-play" @click="actions.chooseFoulPlay">
            {{ ui.menu.choiceKind === 'stalemate' ? '同意重摆' : ui.menu.choiceKind === 'concede' ? '接受认输' : ui.menu.choiceKind === 'black' ? '我先打' : '自己击球' }}
          </button>
          <button
            id="foul-again"
            @click="actions.resolveFoulChoice('again')"
          >
            {{ ['concede', 'stalemate'].includes(ui.menu.choiceKind) ? '继续本局' : ui.menu.choiceKind === 'black' ? '让对方先打' : '让对手重打' }}
          </button>
          <button
            v-if="ui.menu.miss"
            id="foul-replay"
            @click="actions.resolveFoulChoice('replay')"
          >
            回原位重打
          </button>
        </div>
        <p v-else class="rematch-note">等待对手选择…</p>
      </template>

      <template v-else-if="ui.menu.kind === 'free-ball'">
        <div class="room-actions free-ball-actions">
          <button
            v-for="color in freeBallColors"
            :key="color.n"
            @click="actions.resolveFoulChoice('play', color.n)"
          >
            {{ color.label }}球
          </button>
          <button @click="actions.resolveFoulChoice('play')">
            不用自由球
          </button>
        </div>
      </template>

      <template v-else-if="ui.menu.kind === 'concede'">
        <div class="room-actions">
          <button id="concede-yes" @click="actions.confirmConcede">
            确认认输
          </button>
          <button id="concede-no" @click="actions.cancelConcede">
            继续比赛
          </button>
        </div>
      </template>

      <template v-else-if="ui.menu.kind === 'online'">
        <OnlinePanel :ui="ui" :actions="actions" />
      </template>

      <template v-else-if="ui.menu.kind === 'local-over'">
        <p class="final-score">
          <span v-if="ui.mode === 'snk'">
            {{ ui.scores[0] }} : {{ ui.scores[1] }}
          </span>
          <span v-else
            >{{ ui.names?.[ui.winner] || "玩家" + (ui.winner + 1) }} 获胜</span
          >
        </p>
        <p v-if="ui.match.bestOf > 1" class="match-line">
          第 {{ ui.match.frame }} 局 · 局分 {{ ui.match.wins[0] }} :
          {{ ui.match.wins[1] }} · {{ formatLabel(ui.match.bestOf) }}
        </p>
        <div class="room-actions">
          <button id="local-again" @click="actions.playAgainLocal">
            {{ localReplayLabel }}
          </button>
          <button @click="actions.exitToHome">退出</button>
        </div>
      </template>

      <template v-else-if="ui.menu.kind === 'online-over'">
        <p class="final-score">
          <span v-if="ui.mode === 'snk'">
            {{ ui.scores[0] }} : {{ ui.scores[1] }}
          </span>
          <span v-else
            >{{ ui.names?.[ui.winner] || "玩家" + (ui.winner + 1) }} 获胜</span
          >
        </p>
        <p v-if="ui.match.bestOf > 1" class="match-line">
          第 {{ ui.match.frame }} 局 · 局分 {{ ui.match.wins[0] }} :
          {{ ui.match.wins[1] }} · {{ formatLabel(ui.match.bestOf) }}
        </p>
        <div class="room-actions">
          <button
            id="start-online"
            :disabled="meReady"
            @click="actions.requestRematch"
          >
            {{ replayLabel }}
          </button>
          <button @click="actions.backToLobby">返回大厅</button>
        </div>
        <p class="rematch-note">{{ rematchText }}</p>
      </template>

      <template v-else-if="ui.menu.kind === 'online-left'">
        <div class="room-actions">
          <button @click="actions.backToLobby">返回大厅</button>
        </div>
      </template>

      <p v-if="ui.menu.kind !== 'online-left'" class="notice">
        内置休闲规则与瞄准辅助。开局后可随时切换俯视、3D 全景与贴杆视角。
      </p>
    </section>
  </div>
</template>

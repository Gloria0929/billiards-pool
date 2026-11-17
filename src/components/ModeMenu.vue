<script setup>
import { computed, ref, watch } from "vue";
import OnlinePanel from "./OnlinePanel.vue";
import GameLobby from "./GameLobby.vue";
import { MATCH_FORMATS, formatLabel } from "../game/series.js";

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const tab = ref("local");
watch(() => props.ui.menu.kind, (kind) => {
  if (kind === "lobby") tab.value = "lobby";
  else if (kind === "start") tab.value = "local";
});

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

const showModes = computed(() =>
  ["start", "paused", "lobby"].includes(props.ui.menu.kind),
);
const frontRoom = computed(() =>
  showModes.value || ["online", "local-over", "online-over", "online-left"].includes(props.ui.menu.kind),
);
const outcome = computed(() => props.ui.menu.kind.endsWith("-over"));
const matchScore = computed(() =>
  props.ui.match.bestOf > 1 && (props.ui.match.over || props.ui.mode !== "snk"),
);
const compactMenu = computed(() =>
  ["break-choice", "foul-choice", "free-ball"].includes(props.ui.menu.kind),
);
const modes = [
  { id: "pool", name: "中式八球", description: "清完本组球，再打黑八。", balls: 16 },
  { id: "snk", name: "斯诺克", description: "红球和彩球交替得分。", balls: 22 },
  { id: "nine", name: "九球", description: "按号码顺序击球，打进九号获胜。", balls: 9 },
];
const tabs = [
  { id: "local", label: "人机对战" },
  { id: "lobby", label: "游戏大厅" },
  { id: "online", label: "联网对战" },
];
const difficulties = [
  { id: "easy", label: "简单" },
  { id: "normal", label: "普通" },
  { id: "hard", label: "困难" },
];
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
  return "双方都点击「下一局」后，进入下一局。";
});
const panelTitle = computed(() => {
  if (outcome.value) {
    if (props.ui.winner < 0) return "本局平局";
    const name = props.ui.names?.[props.ui.winner] || "玩家" + (props.ui.winner + 1);
    return props.ui.match.over && props.ui.match.bestOf > 1
      ? `${name}赢得整场比赛`
      : `${name}获胜`;
  }
  if (props.ui.menu.kind === "online" && props.ui.online.status === "room") return "对战房间";
  if (!showModes.value) return props.ui.menu.title;
  if (tab.value === "lobby") return "游戏大厅";
  if (tab.value === "online") return "联网对战";
  return "选择玩法";
});
const panelIntro = computed(() => {
  if (outcome.value) {
    const message = props.ui.menu.title;
    const detail = message.match(/[（(](.+)[）)]$/)?.[1];
    if (detail && !/^\d+\s*:\s*\d+$/.test(detail)) return detail;
    return props.ui.match.over && props.ui.match.bestOf === 1 ? "比赛结束。" : "";
  }
  if (!showModes.value || props.ui.menu.kind === "paused") return props.ui.menu.intro;
  if (tab.value === "lobby") return "找一间公开房，向房主申请加入。";
  if (tab.value === "online") return "创建房间，或输入房间码与朋友对战。";
  return "";
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
    :class="{ 'front-room': frontRoom, compact: compactMenu }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ovt"
  >
    <div v-if="frontRoom" class="front-photo">
      <div class="front-brand">
        <span aria-hidden="true">8</span>
        真实台球
      </div>
    </div>

    <section :class="frontRoom ? 'front-panel' : 'mode-panel'">
      <nav v-if="showModes" class="front-nav" aria-label="对局方式">
        <button
          v-for="item in tabs"
          :key="item.id"
          :aria-current="tab === item.id ? 'page' : null"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="menu-body">
        <header class="menu-heading">
          <button
            v-if="ui.menu.kind === 'paused'"
            id="resume"
            class="front-text-button back-to-match"
            @click="actions.resumeGame"
          >
            <span class="front-arrow front-arrow-back" aria-hidden="true"></span> 返回当前对局
          </button>
          <h1 id="ovt">{{ panelTitle }}</h1>
          <p v-if="panelIntro" class="intro">{{ panelIntro }}</p>
        </header>

        <template v-if="showModes">
          <template v-if="tab === 'local'">
            <div class="play-options" role="group" aria-label="选择玩法">
              <button
                v-for="(mode, index) in modes"
                :key="mode.id"
                :id="'m' + (index + 1)"
                class="play-choice"
                :aria-pressed="ui.selectedMode === mode.id"
                @click="actions.selectMode(mode.id)"
              >
                <span class="play-icon" :class="'play-icon-' + mode.id" aria-hidden="true">
                  <span v-if="mode.id === 'pool'" class="play-eight"><b>8</b></span>
                  <span v-else-if="mode.id === 'nine'" class="play-nine"><b>9</b></span>
                  <span v-else class="play-reds"><i></i><i></i><i></i></span>
                </span>
                <span class="play-description">
                  <strong>{{ mode.name }}</strong>
                  <span>{{ mode.description }}</span>
                </span>
                <span class="play-count">{{ mode.balls }} 颗球</span>
                <span class="play-indicator" aria-hidden="true"></span>
              </button>
            </div>

            <div class="play-config">
              <div class="play-setting">
                <span class="field-label" id="difficulty-label">电脑难度</span>
                <div class="front-segments" role="group" aria-labelledby="difficulty-label">
                  <button
                    v-for="difficulty in difficulties"
                    :id="'diff-' + difficulty.id"
                    :key="difficulty.id"
                    :aria-pressed="ui.aiDifficulty === difficulty.id"
                    @click="actions.setAiDifficulty(difficulty.id)"
                  >
                    {{ difficulty.label }}
                  </button>
                </div>
              </div>
              <div class="play-setting">
                <span class="field-label" id="format-label">赛制</span>
                <div class="front-segments" role="group" aria-labelledby="format-label">
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
              <p class="difficulty-hint">{{ difficultyNote }}</p>
            </div>
            <button id="start" class="front-primary start-game" @click="actions.startLocal">
              开始对局 <span class="front-arrow front-arrow-diagonal" aria-hidden="true"></span>
            </button>
          </template>

          <GameLobby
            v-else-if="tab === 'lobby'"
            :ui="ui"
            :actions="actions"
            @create="openOnlineFromLobby"
          />

          <OnlinePanel v-else :ui="ui" :actions="actions" @browse="tab = 'lobby'" />
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
          <OnlinePanel :ui="ui" :actions="actions" @browse="actions.leaveRoom" />
        </template>

        <template v-else-if="outcome">
          <div v-if="ui.mode === 'snk' || matchScore" class="result-scoreboard" :aria-label="matchScore ? '局分' : '本局得分'">
            <div v-for="seat in [0, 1]" :key="seat" class="result-score" :class="{ winner: ui.winner === seat }">
              <span>{{ ui.names?.[seat] || "玩家" + (seat + 1) }}</span>
              <strong>{{ matchScore ? ui.match.wins[seat] : ui.scores[seat] }}</strong>
            </div>
          </div>
          <p v-if="ui.match.bestOf > 1" class="match-line">
            {{ ui.match.over ? "比赛结束" : `第 ${ui.match.frame} 局结束` }} · {{ formatLabel(ui.match.bestOf) }}
            <template v-if="!matchScore">
              · 局分 {{ ui.match.wins[0] }} : {{ ui.match.wins[1] }}
            </template>
          </p>
          <div v-if="ui.menu.kind === 'local-over'" class="room-actions">
            <button v-if="!ui.match.over" id="local-again" class="front-primary" @click="actions.playAgainLocal">
              下一局
            </button>
            <button :class="{ 'front-primary': ui.match.over }" @click="actions.exitToHome">返回首页</button>
          </div>
          <template v-else>
            <div class="room-actions">
              <button
                v-if="!ui.match.over"
                id="start-online"
                class="front-primary"
                :disabled="meReady"
                @click="actions.requestRematch"
              >
                {{ meReady ? "已准备，等待对手" : "下一局" }}
              </button>
              <button :class="{ 'front-primary': ui.match.over }" @click="actions.leaveRoom">返回大厅</button>
            </div>
            <p v-if="!ui.match.over" class="rematch-note">{{ rematchText }}</p>
          </template>
        </template>

        <template v-else-if="ui.menu.kind === 'online-left'">
          <div class="room-actions">
            <button @click="actions.leaveRoom">返回大厅</button>
          </div>
        </template>

      </div>
    </section>
  </div>
</template>

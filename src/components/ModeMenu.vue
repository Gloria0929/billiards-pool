<script setup>
import { computed, ref } from "vue";
import OnlinePanel from "./OnlinePanel.vue";

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const tab = ref("local");

const summary = computed(() =>
  props.ui.selectedMode === "pool"
    ? "已选中式八球 · 清完本组，再打黑八"
    : "已选斯诺克 · 红彩交替，累计得分",
);
const startLabel = computed(() =>
  props.ui.selectedMode === "pool" ? "开始游戏 →" : "开始游戏 →",
);
const showModes = computed(() =>
  ["start", "paused", "over"].includes(props.ui.menu.kind),
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
  return "双方都点击「再来一局」后，会重新摆球开始新一局。";
});
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
      <h1 id="ovt">{{ ui.menu.title }}</h1>
      <p class="intro">{{ ui.menu.intro }}</p>

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
          <div class="mode-footer">
            <p>
              <span id="mode-summary">{{ summary }}</span
              ><br />你与电脑轮流击球 · 支持鼠标与触屏
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

        <OnlinePanel v-else :ui="ui" :actions="actions" />
      </template>

      <template v-else-if="ui.menu.kind === 'online'">
        <OnlinePanel :ui="ui" :actions="actions" />
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
        <div class="room-actions">
          <button
            id="start-online"
            :disabled="meReady"
            @click="actions.requestRematch"
          >
            {{ meReady ? "已准备，等待对手" : "再来一局" }}
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

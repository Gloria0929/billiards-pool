<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PlayerCard from "./PlayerCard.vue";
import BallChip from "./BallChip.vue";
import SettingsPanel from "./SettingsPanel.vue";
import { formatLabel } from "../game/series.js";

const props = defineProps({
  ui: { type: Object, required: true },
  actions: { type: Object, required: true },
});

const onlineOpen = ref(false);
const popEl = ref(null);
const triggerEl = ref(null);

const SNOOKER_COLORS = [
  { name: "黄球", hex: "#e8c41c" },
  { name: "绿球", hex: "#148744" },
  { name: "棕球", hex: "#7c4524" },
  { name: "蓝球", hex: "#1f5cc8" },
  { name: "粉球", hex: "#ee88ac" },
  { name: "黑球", hex: "#1d1e20" },
];

const snookerTarget = computed(() => {
  if (props.ui.mode !== "snk") return null;
  if (props.ui.snookerOnRed) return { label: "红球", hex: "#c81820" };
  if (props.ui.snookerFinalColor) {
    const c = SNOOKER_COLORS[props.ui.snookerColorIndex] || SNOOKER_COLORS[5];
    return { label: c.name, hex: c.hex };
  }
  return {
    label: "彩球",
    hex: "conic-gradient(#e8c41c 0 60deg, #148744 60deg 120deg, #7c4524 120deg 180deg, #1f5cc8 180deg 240deg, #ee88ac 240deg 300deg, #222 300deg)",
  };
});

const snookerDiff = computed(() =>
  Math.abs((props.ui.scores?.[0] ?? 0) - (props.ui.scores?.[1] ?? 0)),
);

const onlineActive = computed(
  () =>
    props.ui.online.status === "room" || props.ui.online.status === "playing",
);
const watching = computed(
  () =>
    props.ui.online.status === "playing" &&
    props.ui.online.seat != null &&
    props.ui.online.seat !== props.ui.turn,
);

const turnNote = computed(() => {
  const { online, turn, phase, names, spin, power } = props.ui;
  const spinLabels = [];
  if (Math.abs(spin.y) > 0.02) spinLabels.push(spin.y > 0 ? "高杆" : "低杆");
  if (Math.abs(spin.x) > 0.02) spinLabels.push(spin.x > 0 ? "右塞" : "左塞");
  const detail = spinLabels.length ? " " + spinLabels.join("") : "";
  const shotNote = `力度 ${Math.round(power * 100)}%${detail}`;
  if (online.status === "idle") {
    if (turn !== 1 || phase !== "aim" || !names) return "";
    return props.ui.aiShotReady
      ? `电脑正在瞄准… · ${shotNote}`
      : "电脑正在瞄准…";
  }
  if (online.status !== "playing") return "";
  if (online.waiting) return "正在同步击球…";
  const opponent = 1 - online.seat;
  const name = names?.[opponent] || online.players?.[opponent]?.name || "对手";
  if (online.players[opponent]?.connected === false) {
    if (turn === opponent && phase === "aim") return `电脑正在替 ${name} 击球…`;
    return `${name} 已离线 · 电脑接管其回合`;
  }
  if (online.seat === turn) return "";
  return `正在观看 ${name} 瞄准… · ${shotNote}`;
});

const views = [
  { id: "top", label: "俯视" },
  { id: "orbit", label: "3D 全景" },
  { id: "fp", label: "贴杆瞄准" },
];

function displayName(seat) {
  return (
    props.ui.names?.[seat] ||
    props.ui.online.players?.[seat]?.name ||
    `玩家${seat + 1}`
  );
}

function tagFor(seat) {
  if (onlineActive.value) return seat === props.ui.online.seat ? "你" : "对手";
  if (seat === 1 && props.ui.names) return "AI";
  return "";
}

function toggleOnline() {
  props.actions.closeSettings();
  onlineOpen.value = !onlineOpen.value;
}

function toggleSettings() {
  onlineOpen.value = false;
  props.actions.toggleSettings();
}

function leaveRoom() {
  onlineOpen.value = false;
  props.actions.leaveRoom();
}

function onDocumentPointerDown(event) {
  if (!onlineOpen.value) return;
  if (popEl.value?.contains(event.target)) return;
  if (triggerEl.value?.contains(event.target)) return;
  onlineOpen.value = false;
}

onMounted(() =>
  document.addEventListener("pointerdown", onDocumentPointerDown),
);
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", onDocumentPointerDown),
);
</script>

<template>
  <header id="hud" :inert="ui.menu.visible">
    <div class="hud-top">
      <div class="brand">
        <span class="brand-mark">8</span>
        <div>
          <div class="brand-name">真实台球</div>
          <small id="mode-label">{{ ui.modeLabel }}</small>
        </div>
      </div>

      <div class="scoreboard">
        <PlayerCard
          :seat="0"
          :label="displayName(0)"
          :tag="tagFor(0)"
          :active="ui.phase !== 'over' && ui.turn === 0"
          :mode="ui.mode"
          :group="ui.groups[0]"
          :score="ui.scores[0]"
          :balls="ui.balls"
        />

        <div class="score-center">
          <div
            v-if="ui.match && ui.match.bestOf > 1"
            class="hud-match"
            :title="formatLabel(ui.match.bestOf)"
          >
            <small>第 {{ ui.match.frame }} 局</small>
            <b>{{ ui.match.wins[0] }} : {{ ui.match.wins[1] }}</b>
          </div>
          <div
            v-else-if="ui.mode === 'nine' && ui.phase !== 'over'"
            class="hud-target"
            title="九球：每杆先碰台面最小号球，合法打进 9 号球获胜"
          >
            <small>目标</small>
            <BallChip :n="ui.nineTarget || 1" :on="true" />
            <span>剩 {{ ui.nineRemaining }}</span>
          </div>
          <span v-else class="score-vs">VS</span>
        </div>

        <PlayerCard
          :seat="1"
          :label="displayName(1)"
          :tag="tagFor(1)"
          :active="ui.phase !== 'over' && ui.turn === 1"
          :mode="ui.mode"
          :group="ui.groups[1]"
          :score="ui.scores[1]"
          :balls="ui.balls"
        />
      </div>

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
        <button v-if="ui.canRequestStalemate" @click="actions.requestStalemate">
          重摆
        </button>
        <button
          v-if="ui.mode === 'snk' && ui.phase !== 'over'"
          id="concede"
          :disabled="!ui.canConcede"
          :title="
            ui.canConcede
              ? '本局认输'
              : '轮到你击球且已有一方需要罚分追分时才能认输'
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
        <button v-else id="nb" @click="actions.openMenu">退出</button>
        <SettingsPanel v-if="ui.settingsOpen" :ui="ui" :actions="actions" />
      </div>
    </div>

    <div class="hud-sub">
      <div
        v-if="ui.mode === 'snk' && ui.phase !== 'over'"
        class="hud-snooker-bar"
      >
        <div
          v-if="ui.snookerBreak > 0"
          class="hud-break"
          title="当前连续得分（单杆）"
        >
          <small>单杆</small>
          <b>{{ ui.snookerBreak }}</b>
        </div>
        <div
          v-if="snookerTarget"
          class="hud-snk-target"
          :title="`当前目标球：${snookerTarget.label}`"
        >
          <i class="snk-dot" :style="{ background: snookerTarget.hex }"></i>
          <span>{{ snookerTarget.label }}</span>
        </div>
        <div
          class="hud-remaining"
          title="台面理论最高可得分数与当前分差"
        >
          <small>剩分</small>
          <b>{{ ui.snookerRemaining }}</b>
          <em v-if="snookerDiff > 0" class="hud-diff">差 {{ snookerDiff }}</em>
        </div>
      </div>

      <div
        v-if="turnNote || ui.message"
        id="msg"
        role="status"
        aria-live="polite"
      >
        {{ turnNote || ui.message }}
      </div>
    </div>

    <div v-if="onlineOpen" ref="popEl" class="online-pop">
      <h4>联机房间</h4>
      <p>
        房间码 <span class="code">{{ ui.online.code }}</span>
      </p>
      <p>
        你是{{ ui.online.seat === 0 ? "房主" : "挑战者" }} · 对手：{{
          displayName(1 - ui.online.seat)
        }}
      </p>
      <p>辅助线：{{ ui.online.guide ? "开" : "关" }}</p>
      <button @click="leaveRoom">
        {{ ui.online.status === "playing" ? "暂离房间" : "离开房间" }}
      </button>
    </div>
  </header>
</template>

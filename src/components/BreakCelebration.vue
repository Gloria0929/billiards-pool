<script setup>
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({ ui: { type: Object, required: true } });
const notice = ref(null);
let timer = null;

function clear() {
  clearTimeout(timer);
  notice.value = null;
}

watch(
  () => props.ui.snookerCelebration,
  (celebration) => {
    clear();
    if (!celebration) return;
    const { points, seat, full } = celebration;
    notice.value = {
      points,
      full,
      name: props.ui.names?.[seat] || `玩家${seat + 1}`,
    };
    timer = setTimeout(clear, 5200);
  },
);

onBeforeUnmount(clear);
</script>

<template>
  <Transition name="break-toast">
    <aside
      v-if="notice"
      :key="notice.full ? 'maximum' : 'century'"
      class="break-celebration"
      :class="{ 'is-maximum': notice.full }"
      role="status"
      aria-live="polite"
    >
      <div class="break-sparks" aria-hidden="true">
        <i v-for="n in 12" :key="n" :style="{ '--i': n }"></i>
      </div>
      <span class="break-celebration-kicker">{{
        notice.full ? "MAXIMUM BREAK" : "CENTURY BREAK"
      }}</span>
      <strong>{{ notice.points }}</strong>
      <b>{{ notice.full ? "满分杆，147！" : "单杆破百！" }}</b>
      <span
        >{{ notice.name }} ·
        {{ notice.full ? "这一杆，值得记住" : "好球，破百了" }}</span
      >
    </aside>
  </Transition>
</template>

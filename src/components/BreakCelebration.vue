<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({ ui: { type: Object, required: true } })
const notice = ref(null)
let timer = null

function clear() {
  clearTimeout(timer)
  notice.value = null
}

watch(() => [props.ui.mode, props.ui.snookerBreakScore, props.ui.snookerBreakSeat,
  props.ui.snookerMaximum, props.ui.menu.kind, props.ui.menu.visible], (next, previous = []) => {
  const [mode, points, seat, maximum, menu, visible] = next
  if (mode !== 'snk' || (visible && (['start', 'lobby'].includes(menu) || menu.endsWith('-over')))) return clear()
  const full = maximum && !previous[3]
  if (!full && !(points >= 100 && (previous[1] < 100 || seat !== previous[2]))) return
  clearTimeout(timer)
  const player = full ? maximum.seat : seat
  notice.value = {
    points: full ? 147 : points,
    full: !!full,
    name: props.ui.names?.[player] || `玩家${player + 1}`,
  }
  timer = setTimeout(clear, 5200)
})

onBeforeUnmount(clear)
</script>

<template>
  <Transition name="break-toast">
    <aside v-if="notice" :key="notice.full ? 'maximum' : 'century'"
      class="break-celebration" :class="{ 'is-maximum': notice.full }" role="status" aria-live="polite">
      <div class="break-sparks" aria-hidden="true"><i v-for="n in 12" :key="n" :style="{ '--i': n }"></i></div>
      <span class="break-celebration-kicker">{{ notice.full ? 'MAXIMUM BREAK' : 'CENTURY BREAK' }}</span>
      <strong>{{ notice.points }}</strong>
      <b>{{ notice.full ? '满分杆，147！' : '单杆破百！' }}</b>
      <span>{{ notice.name }} · {{ notice.full ? '这一杆，值得记住' : '好手感，继续这一杆' }}</span>
    </aside>
  </Transition>
</template>

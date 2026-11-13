<script setup>
import { computed } from 'vue'
import BallChip from './BallChip.vue'

const props = defineProps({
  seat: { type: Number, required: true },
  label: { type: String, required: true },
  tag: { type: String, default: '' },
  active: { type: Boolean, default: false },
  mode: { type: String, default: 'pool' },
  group: { type: String, default: null },
  score: { type: Number, default: 0 },
  balls: { type: Array, default: () => [] },
})

const onTable = computed(() => new Set(props.balls.filter((b) => b.on).map((b) => b.n)))
const groupBalls = computed(() => {
  if (props.mode === 'snk' || !props.group) return []
  return props.group === 'solid'
    ? [1, 2, 3, 4, 5, 6, 7]
    : [9, 10, 11, 12, 13, 14, 15]
})
</script>

<template>
  <div class="pl" :class="{ on: active }">
    <b>{{ label }}<em v-if="tag" class="pl-tag">{{ tag }}</em></b>
    <template v-if="mode === 'snk'">
      <small>得分</small><b>{{ score }}</b>
    </template>
    <template v-else>
      <small>{{ group === 'solid' ? '全色' : group === 'stripe' ? '花色' : '未定' }}</small>
      <BallChip
        v-for="n in groupBalls"
        :key="n"
        :n="n"
        :on="onTable.has(n)"
      />
    </template>
  </div>
</template>

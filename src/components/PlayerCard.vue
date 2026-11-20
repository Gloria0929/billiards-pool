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
const groupLabel = computed(() => {
  if (props.group === 'solid') return '全色'
  if (props.group === 'stripe') return '花色'
  return '未定'
})
</script>

<template>
  <div class="pl" :class="{ on: active, 'pl-right': seat === 1 }">
    <span class="pl-dot" aria-hidden="true"></span>
    <span class="pl-name">{{ label }}<em v-if="tag" class="pl-tag">{{ tag }}</em></span>
    <span v-if="mode !== 'nine'" class="pl-meta">
      <template v-if="mode === 'snk'">
        <b class="pl-score">{{ score }}</b>
      </template>
      <template v-else>
        <span class="pl-group">{{ groupLabel }}</span>
        <span v-if="groupBalls.length" class="pl-chips">
          <BallChip v-for="n in groupBalls" :key="n" :n="n" :on="onTable.has(n)" />
        </span>
      </template>
    </span>
  </div>
</template>

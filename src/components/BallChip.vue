<script setup>
import { computed } from 'vue'
import { COL } from '../game/constants.js'

const props = defineProps({
  n: { type: Number, required: true },
  on: { type: Boolean, default: true },
})

const color = computed(() => COL[props.n > 8 ? props.n - 8 : props.n])
</script>

<template>
  <span class="chip" :class="{ st: n > 8, d: !on }" :style="{ '--c': color }">
    <i>{{ n }}</i>
  </span>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'

const props = defineProps({
  spin: { type: Object, default: () => ({ x: 0, y: 0 }) },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update'])

const canvas = ref(null)
let drawing = false

function draw() {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  ctx.clearRect(0, 0, 128, 128)
  ctx.fillStyle = '#f4f1ea'
  ctx.beginPath()
  ctx.arc(64, 64, 62, 0, 7)
  ctx.fill()
  ctx.strokeStyle = '#0003'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(64, 6)
  ctx.lineTo(64, 122)
  ctx.moveTo(6, 64)
  ctx.lineTo(122, 64)
  ctx.stroke()
  ctx.fillStyle = '#d3262b'
  ctx.beginPath()
  ctx.arc(64 + props.spin.x * 98, 64 - props.spin.y * 98, 9, 0, 7)
  ctx.fill()
}

function point(event) {
  const rect = canvas.value.getBoundingClientRect()
  let x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  let y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  const length = Math.hypot(x, y)
  if (length > 0.65) {
    x *= 0.65 / length
    y *= 0.65 / length
  }
  emit('update', { x, y })
}

function down(event) {
  if (props.disabled) return
  drawing = true
  canvas.value.setPointerCapture(event.pointerId)
  point(event)
}

function move(event) {
  if (!drawing || props.disabled) return
  point(event)
}

function up() {
  drawing = false
}

function reset() {
  if (props.disabled) return
  emit('update', { x: 0, y: 0 })
}

onMounted(draw)
watch(() => [props.spin.x, props.spin.y], draw)
</script>

<template>
  <canvas
    ref="canvas"
    id="sp"
    width="128"
    height="128"
    aria-label="旋转击点，双击恢复中心"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="up"
    @dblclick="reset"
  ></canvas>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const MAX_SPIN = 0.65
const BALL_R = 0.484
const DOT_R = 0.075

const props = defineProps({
  spin: { type: Object, default: () => ({ x: 0, y: 0 }) },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update'])

const canvas = ref(null)
let drawing = false
let observer = null

function draw() {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  const size = el.width
  const c = size / 2
  const ballR = size * BALL_R
  const dotR = size * DOT_R
  const edgeR = ballR - dotR
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#f4f1ea'
  ctx.beginPath()
  ctx.arc(c, c, ballR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#00000026'
  ctx.lineWidth = size / 64
  ctx.beginPath()
  ctx.moveTo(c, c - ballR)
  ctx.lineTo(c, c + ballR)
  ctx.moveTo(c - ballR, c)
  ctx.lineTo(c + ballR, c)
  ctx.stroke()
  ctx.fillStyle = '#d3262b'
  let sx = props.spin.x
  let sy = props.spin.y
  const spinLen = Math.hypot(sx, sy)
  if (spinLen > MAX_SPIN) {
    sx *= MAX_SPIN / spinLen
    sy *= MAX_SPIN / spinLen
  }
  ctx.beginPath()
  ctx.arc(
    c + (sx / MAX_SPIN) * edgeR,
    c - (sy / MAX_SPIN) * edgeR,
    dotR,
    0,
    Math.PI * 2,
  )
  ctx.fill()
}

function resize() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const size = Math.max(64, Math.round((rect.width || 96) * dpr))
  if (el.width !== size) {
    el.width = size
    el.height = size
  }
  draw()
}

function point(event) {
  const el = canvas.value
  const rect = el.getBoundingClientRect()
  const half = Math.min(rect.width, rect.height) / 2
  let x = (event.clientX - rect.left - rect.width / 2) / half
  let y = -(event.clientY - rect.top - rect.height / 2) / half
  // 红点圆心与指针严格重合，最多贴到白球内缘，保证“点哪打哪”。
  const limit = (BALL_R - DOT_R) / 0.5
  const length = Math.hypot(x, y)
  if (length > limit) {
    x *= limit / length
    y *= limit / length
  }
  emit('update', {
    x: (x / limit) * MAX_SPIN,
    y: (y / limit) * MAX_SPIN,
  })
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

onMounted(() => {
  resize()
  observer = new ResizeObserver(resize)
  observer.observe(canvas.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
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

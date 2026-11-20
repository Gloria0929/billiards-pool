<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const MAX_SPIN = 0.65
const BALL_R = 0.48
const DOT_R = 0.072

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
  const edgeR = ballR - dotR * 1.1
  ctx.clearRect(0, 0, size, size)

  // 3D 球体立体渐变底色
  const sphere = ctx.createRadialGradient(
    c - ballR * 0.3,
    c - ballR * 0.32,
    ballR * 0.08,
    c,
    c,
    ballR,
  )
  sphere.addColorStop(0, '#ffffff')
  sphere.addColorStop(0.58, '#f0ece1')
  sphere.addColorStop(0.86, '#cfc7b6')
  sphere.addColorStop(1, '#9c9381')
  ctx.fillStyle = sphere
  ctx.beginPath()
  ctx.arc(c, c, ballR, 0, Math.PI * 2)
  ctx.fill()

  // 精细同心刻度圈（半塞 / 满塞边界）与十字准星
  ctx.strokeStyle = 'rgba(20, 22, 20, 0.14)'
  ctx.lineWidth = Math.max(1, size / 96)
  ctx.beginPath()
  ctx.arc(c, c, edgeR * 0.52, 0, Math.PI * 2)
  ctx.moveTo(c, c - ballR * 0.9)
  ctx.lineTo(c, c + ballR * 0.9)
  ctx.moveTo(c - ballR * 0.9, c)
  ctx.lineTo(c + ballR * 0.9, c)
  ctx.stroke()

  ctx.save()
  ctx.strokeStyle = 'rgba(20, 22, 20, 0.12)'
  ctx.setLineDash([Math.max(2, size / 44), Math.max(2, size / 44)])
  ctx.beginPath()
  ctx.arc(c, c, edgeR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // 击球点（带白环的红点，精准醒目）
  let sx = props.spin.x
  let sy = props.spin.y
  const spinLen = Math.hypot(sx, sy)
  if (spinLen > MAX_SPIN) {
    sx *= MAX_SPIN / spinLen
    sy *= MAX_SPIN / spinLen
  }
  const dx = c + (sx / MAX_SPIN) * edgeR
  const dy = c - (sy / MAX_SPIN) * edgeR

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.beginPath()
  ctx.arc(dx, dy + size * 0.015, dotR * 1.2, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#cf352b'
  ctx.beginPath()
  ctx.arc(dx, dy, dotR, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = Math.max(1.2, size / 56)
  ctx.stroke()
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

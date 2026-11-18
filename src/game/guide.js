import { DT } from './constants.js'
import { launchShot } from './match.js'
import { moving, step } from './physics.js'

const MAX_GUIDE_STEPS = Math.round(10 / DT)
const DEFLECT_LENGTH = 320
const point = (ball) => ({ x: ball.x, y: ball.y })
const path = (ball) => ({ from: point(ball), to: point(ball), points: [point(ball)], pocket: null })

function sample(route, ball, force = false) {
  route.to = point(ball)
  const last = route.points.at(-1)
  const distance = Math.hypot(ball.x - last.x, ball.y - last.y)
  if (distance >= 12 || (force && distance > 1e-6)) route.points.push(point(ball))
}

function pocket(geo, ball) {
  if (!ball.q) return null
  return { x: ball.q[0], y: ball.q[1], r: ball.q[2] }
}

// Preview the same launch, friction, spin transfer and cushion polygons as a real shot.
// Only the first target and one cushion rebound are shown to keep the guide readable.
export function buildAimGuide(geo, balls, angle, includeObject = true, shot = {}) {
  const trial = {
    geo,
    mode: geo.mode,
    balls: balls.map((ball) => ({ ...ball })),
    turn: 0,
    grp: [null, null],
    sn: {},
    inHand: false,
    breakShot: !!shot.breakShot,
  }
  launchShot(trial, { ...shot, angle })
  const cue = trial.balls[0]
  const cuePath = path(cue)
  const guide = {
    cue: point(cue),
    cuePath,
    ghost: point(cue),
    hitBall: null,
    cueBank: null,
    cuePocket: null,
    object: null,
    objectBank: null,
    objectPocket: null,
    deflect: null,
  }
  let cueRoute = cuePath
  let target = null
  let targetRoute = null
  let cueDone = false
  let targetDone = true
  let deflectDistance = 0
  let previousCue = point(cue)

  for (let i = 0; i < MAX_GUIDE_STEPS && (!cueDone || !targetDone); i++) {
    if (!moving(trial.balls)) break
    trial.events.length = 0
    step(trial)
    if (!cueDone) {
      sample(cueRoute, cue)
      if (cueRoute === guide.deflect)
        deflectDistance += Math.hypot(cue.x - previousCue.x, cue.y - previousCue.y)
    }
    previousCue = point(cue)
    if (!targetDone) sample(targetRoute, target)

    for (const event of trial.events) {
      if (event.k === 'b') {
        const pair = String(event.id).split('-').map(Number)
        if (pair.includes(0) && !guide.hitBall && !cueDone) {
          const number = pair.find((n) => n !== 0)
          target = trial.balls.find((ball) => ball.n === number)
          guide.hitBall = balls.find((ball) => ball.n === number)
          guide.ghost = point(cue)
          sample(cueRoute, cue, true)
          guide.deflect = cueRoute = path(cue)
          if (includeObject) {
            guide.object = targetRoute = path(target)
            targetDone = false
          }
        } else {
          if (pair.includes(0) && !cueDone) {
            sample(cueRoute, cue, true)
            cueDone = true
          }
          if (target && pair.includes(target.n) && !targetDone) {
            sample(targetRoute, target, true)
            targetDone = true
          }
        }
      } else if (event.k === 'r') {
        if (event.id === 0 && !cueDone) {
          sample(cueRoute, cue, true)
          if (cueRoute === cuePath) guide.cueBank = cueRoute = path(cue)
          else cueDone = true
        }
        if (target && event.id === target.n && !targetDone) {
          sample(targetRoute, target, true)
          if (targetRoute === guide.object) guide.objectBank = targetRoute = path(target)
          else targetDone = true
        }
      }
    }
    if (!cueDone && (!cue.on || !(cue.vx || cue.vy || cue.wx || cue.wy) ||
        deflectDistance >= DEFLECT_LENGTH)) {
      sample(cueRoute, cue, true)
      cueRoute.pocket = pocket(geo, cue)
      guide.cuePocket = cueRoute.pocket
      cueDone = true
    }
    if (!targetDone && (!target.on || !(target.vx || target.vy || target.wx || target.wy))) {
      sample(targetRoute, target, true)
      targetRoute.pocket = pocket(geo, target)
      guide.objectPocket = targetRoute.pocket
      targetDone = true
    }
  }
  sample(cueRoute, cueRoute.to, true)
  if (targetRoute) sample(targetRoute, targetRoute.to, true)
  if (!guide.hitBall) guide.ghost = cuePath.to
  return guide
}

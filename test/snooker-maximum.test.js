import assert from 'node:assert/strict'
import test from 'node:test'
import { createMatch, hydrateState, launchShot, publicState, snapshot } from '../src/game/match.js'
import { endShot, resolveSnookerChoice } from '../src/game/rules.js'

function pot(state, number, scratch = false) {
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = number
  state.potted = [number]
  state.cueIn = scratch
  state.balls.find((ball) => ball.n === number).on = false
  if (scratch) state.balls[0].on = false
  endShot(state)
}

function start(seat = 0) {
  const state = createMatch('snk', 7, ['你', '电脑'])
  state.breakShot = state.inHand = false
  state.turn = seat
  return state
}

function redsAndBlacks(state) {
  for (let red = 1; red <= 15; red++) {
    pot(state, red)
    pot(state, 21)
  }
}

test('完整 15 红 15 黑加清彩，单杆 147 触发彩蛋，双方及联机快照一致', () => {
  for (const seat of [0, 1]) {
    let state = start(seat)
    redsAndBlacks(state)
    assert.equal(state.sn.breakScore, 120)
    assert.equal(snapshot(state).breakScore, 120)
    assert.equal(snapshot(state).breakSeat, seat)
    assert.equal(state.sn.maximumBreak, null)
    // 联机中途恢复后，单杆计分必须继续保留。
    state = hydrateState(JSON.parse(JSON.stringify(publicState(state))))
    for (let color = 16; color <= 20; color++) pot(state, color)
    assert.equal(state.sn.breakScore, 140)
    assert.equal(state.phase, 'aim')
    assert.equal(state.sn.maximumBreak, null)
    pot(state, 21)
    assert.equal(state.phase, 'over')
    assert.equal(state.winner, seat)
    assert.equal(state.sn.score[seat], 147)
    assert.equal(state.sn.breakScore, 147)
    assert.deepEqual(state.sn.maximumBreak, { seat, points: 147 })
    assert.deepEqual(state.sn.centuryBreak, { seat, points: 147 })
    const remote = hydrateState(publicState(state))
    assert.deepEqual(snapshot(remote).maximumBreak, { seat, points: 147 })
    assert.deepEqual(snapshot(remote).centuryBreak, { seat, points: 147 })
  }
})

test('总分达到 147 但来自两次上手，不触发单杆彩蛋', () => {
  const state = start()
  pot(state, 1)
  pot(state, 21)
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = 2
  endShot(state)
  assert.equal(state.sn.breakScore, 0)
  assert.equal(state.turn, 1)
  launchShot(state, { angle: 0, power: 0.3 })
  state.firstHit = 2
  endShot(state)
  assert.equal(state.turn, 0)
  for (let red = 2; red <= 15; red++) {
    pot(state, red)
    pot(state, 21)
  }
  for (let color = 16; color <= 21; color++) pot(state, color)
  assert.equal(state.sn.score[0], 147)
  assert.equal(state.sn.breakScore, 139)
  assert.equal(state.sn.maximumBreak, null)
})

test('犯规后要求留位重打，从新单杆开始计分', () => {
  const state = start()
  pot(state, 1)
  pot(state, 21, true)
  assert.equal(state.sn.breakScore, 0)
  assert.equal(state.sn.breakSeat, null)
  assert.deepEqual(state.sn.score, [1, 7])
  resolveSnookerChoice(state, 'again')
  pot(state, 2)
  assert.equal(state.sn.breakScore, 1)
  assert.equal(state.sn.breakSeat, 0)
  assert.equal(state.sn.maximumBreak, null)
})

test('普通清台和新局不会出现 147 彩蛋，旧快照可兼容', () => {
  const state = start()
  // 先前获得的罚分不能算进本次单杆。
  state.sn.score[0] = 5
  pot(state, 1)
  pot(state, 16)
  for (let red = 2; red <= 15; red++) {
    pot(state, red)
    pot(state, 21)
  }
  for (let color = 16; color <= 21; color++) pot(state, color)
  assert.equal(state.sn.score[0], 147)
  assert.equal(state.sn.breakScore, 142)
  assert.equal(state.sn.maximumBreak, null)
  const fresh = start()
  assert.equal(fresh.sn.maximumBreak, null)
  assert.equal(fresh.sn.centuryBreak, null)
  const old = publicState(fresh)
  delete old.sn.breakScore
  delete old.sn.breakSeat
  delete old.sn.maximumBreak
  delete old.sn.centuryBreak
  assert.equal(hydrateState(old).sn.breakScore, 0)
  assert.equal(snapshot(old).maximumBreak, null)
  assert.equal(snapshot(old).centuryBreak, null)
})

test('单杆 99 不触发，达到 100 提示一次并继续记录最终单杆，联机同步保留', () => {
  for (const seat of [0, 1]) {
    let state = start(seat)
    for (let red = 1; red <= 12; red++) {
      pot(state, red)
      pot(state, 21)
    }
    pot(state, 13)
    pot(state, 16)
    assert.equal(state.sn.breakScore, 99)
    assert.equal(state.sn.centuryBreak, null)
    pot(state, 14)
    assert.equal(state.sn.breakScore, 100)
    assert.deepEqual(state.sn.centuryBreak, { seat, points: 100 })
    assert.match(state.message, /单杆破百/)
    state = hydrateState(JSON.parse(JSON.stringify(publicState(state))))
    assert.deepEqual(snapshot(state).centuryBreak, { seat, points: 100 })
    pot(state, 21)
    assert.deepEqual(state.sn.centuryBreak, { seat, points: 107 })
    assert.doesNotMatch(state.message, /单杆破百/)
    // 回合结束时保留本局最高破百，供最终结算展示。
    launchShot(state, { angle: 0, power: 0.3 })
    state.firstHit = 15
    endShot(state)
    assert.equal(state.sn.breakScore, 0)
    assert.deepEqual(state.sn.centuryBreak, { seat, points: 107 })
    assert.equal(state.sn.maximumBreak, null)
  }
})

test('两次上手总分 147、但单杆均不足 100 时，不触发破百彩蛋', () => {
  const state = start()
  for (let red = 1; red <= 8; red++) {
    pot(state, red)
    pot(state, 21)
  }
  for (let seat = 0; seat <= 1; seat++) {
    launchShot(state, { angle: 0, power: 0.3 })
    state.firstHit = 9
    endShot(state)
  }
  for (let red = 9; red <= 15; red++) {
    pot(state, red)
    pot(state, 21)
  }
  for (let color = 16; color <= 21; color++) pot(state, color)
  assert.equal(state.phase, 'over')
  assert.equal(state.sn.score[0], 147)
  assert.equal(state.sn.breakScore, 83)
  assert.equal(state.sn.centuryBreak, null)
  assert.equal(state.sn.maximumBreak, null)
})

test('犯规入袋与罚分不会把不足 100 的单杆变成破百', () => {
  const state = start()
  state.sn.score[0] = 99
  pot(state, 1)
  assert.equal(state.sn.score[0], 100)
  assert.equal(state.sn.centuryBreak, null)
  // 到达单杆 99 后，犯规进球不能贡献第 100 分。
  const attempt = start()
  for (let red = 1; red <= 12; red++) {
    pot(attempt, red)
    pot(attempt, 21)
  }
  pot(attempt, 13)
  pot(attempt, 16)
  pot(attempt, 14, true)
  assert.equal(attempt.sn.breakScore, 0)
  assert.equal(attempt.sn.centuryBreak, null)
})

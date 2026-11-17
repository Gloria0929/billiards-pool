import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceSeries, createSeries, recordFrameResult } from '../src/game/series.js'

test('三局两胜可进入下一局，达到胜场后保留最终比分', () => {
  const series = createSeries(3)
  recordFrameResult(series, 0)
  advanceSeries(series)
  assert.equal(series.frame, 2)
  assert.deepEqual(series.wins, [1, 0])

  recordFrameResult(series, 0)
  const advanced = advanceSeries(series)
  assert.equal(series.over, true)
  assert.equal(advanced, false)
  assert.equal(series.frame, 2)
  assert.deepEqual(series.wins, [2, 0])
})

test('单局也是完整的赛制，打完后停在结算', () => {
  const series = createSeries(1)
  recordFrameResult(series, 1)
  assert.equal(advanceSeries(series), false)
  assert.equal(series.over, true)
  assert.deepEqual(series.wins, [0, 1])
})

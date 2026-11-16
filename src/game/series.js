export const MATCH_FORMATS = [1, 3, 5, 7]

const FORMAT_LABELS = {
  1: '单局',
  3: '三局两胜',
  5: '五局三胜',
  7: '七局四胜',
}

export const normalizeBestOf = (value) =>
  MATCH_FORMATS.includes(Number(value)) ? Number(value) : 1

export const formatLabel = (bestOf) =>
  FORMAT_LABELS[normalizeBestOf(bestOf)]

export const matchTarget = (bestOf) =>
  Math.ceil(normalizeBestOf(bestOf) / 2)

export function createSeries(bestOf = 1) {
  return {
    bestOf: normalizeBestOf(bestOf),
    wins: [0, 0],
    frame: 1,
    over: false,
    recorded: false,
    breakMisses: [0, 0],
  }
}

// 记录本局胜者；同一局只记录一次。
export function recordFrameResult(series, winner) {
  if (!series || series.recorded) return false
  if (winner !== 0 && winner !== 1) return false
  series.recorded = true
  series.wins[winner] += 1
  series.over = series.wins[winner] >= matchTarget(series.bestOf)
  return true
}

// 进入下一局；比赛结束后重新开始一个同赛制的新比赛。
export function advanceSeries(series) {
  if (!series) return
  if (series.over) {
    series.wins = [0, 0]
    series.over = false
    series.frame = 1
    series.breakMisses = [0, 0]
  } else {
    series.frame += 1
  }
  series.recorded = false
}

export function publicSeries(series) {
  return {
    bestOf: normalizeBestOf(series?.bestOf),
    wins: [...(series?.wins || [0, 0])],
    frame: series?.frame || 1,
    over: !!series?.over,
    breakMisses: [...(series?.breakMisses || [0, 0])],
  }
}

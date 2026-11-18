export const MODES = {
  pool: {
    name: '中式八球',
    breakPower: 1,
    W: 2540,
    H: 1270,
    R: 28.6,
    gC: 72,
    gS: 58,
    pc: 72,
    ps: 64,
    py: 36,
  },
  snk: {
    name: '斯诺克',
    breakPower: 0.35,
    W: 3569,
    H: 1778,
    R: 26.25,
    gC: 55,
    gS: 40,
    pc: 62,
    ps: 56,
    py: 28,
  },
  nine: {
    // 九球沿用中八球台，但袋口回到中八收紧前的尺寸。
    name: '九球',
    breakPower: 1,
    W: 2540,
    H: 1270,
    R: 28.6,
    gC: 72,
    gS: 58,
    pc: 78,
    ps: 70,
    py: 36,
  },
}

export const G = 9810
export const MUS = 0.2
export const MUR = 0.012
export const DT = 1 / 2000
export const RAIL = 110
export const BX = 737
export const DR = 292

export const COL = [
  '#f4f1ea',
  '#f2c200',
  '#1c4db0',
  '#d3262b',
  '#5a2b8a',
  '#ef6a1a',
  '#0b7a3d',
  '#7e1d1d',
  '#141414',
]

export const SC = [0xf2d100, 0x0f7a3a, 0x6b3a1e, 0x1c4db0, 0xf08fb0, 0x161616]

export const MAX_SIM_STEPS = 400000

// 瞄准微调步长（弧度）：按钮 / 方向键用 AIM_NUDGE，按住 Shift 时更细。
export const AIM_NUDGE = 0.0004
export const AIM_NUDGE_FINE = 0.0001

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

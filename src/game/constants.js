export const MODES = {
  pool: {
    name: '中式八球',
    W: 2540,
    H: 1270,
    R: 28.6,
    gC: 72,
    gS: 58,
    pc: 78,
    ps: 70,
    py: 14,
  },
  snk: {
    name: '斯诺克',
    W: 3569,
    H: 1778,
    R: 26.25,
    gC: 55,
    gS: 40,
    pc: 62,
    ps: 56,
    py: 10,
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

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

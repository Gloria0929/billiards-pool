export function renderQuality(coarsePointer, devicePixelRatio = 1) {
  return {
    pixelRatio: Math.min(coarsePointer ? 1.25 : 2, devicePixelRatio),
    shadows: !coarsePointer,
    antialias: !coarsePointer,
    ballSegments: coarsePointer ? [20, 14] : [32, 24],
    anisotropy: coarsePointer ? 2 : 8,
    guideInterval: coarsePointer ? 80 : 0,
  }
}

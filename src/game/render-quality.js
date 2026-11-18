export function renderQuality(coarsePointer, devicePixelRatio = 1) {
  return {
    pixelRatio: Math.min(coarsePointer ? 1.5 : 2, devicePixelRatio),
    shadows: true,
    dynamicShadows: !coarsePointer,
    antialias: true,
    ballSegments: [32, 24],
    anisotropy: 8,
    backgroundGuide: coarsePointer,
    interpolateBallMotion: !coarsePointer,
  }
}

export function renderQuality(coarsePointer, devicePixelRatio = 1) {
  return {
    pixelRatio: Math.min(coarsePointer ? 1.5 : 2, devicePixelRatio),
    shadowSize: coarsePointer ? 1024 : 1536,
    shadows: true,
    dynamicShadows: !coarsePointer,
    antialias: true,
    ballSegments: [48, 32],
    anisotropy: 8,
    backgroundGuide: coarsePointer,
    interpolateBallMotion: !coarsePointer,
  }
}

import * as THREE from 'three'

export function surfaceColor(hex) {
  return new THREE.Color(hex).convertSRGBToLinear()
}

export function loadTableMaps(anisotropy) {
  const loader = new THREE.TextureLoader()
  function load(url, x, y, isColor = false) {
    const map = loader.load(url)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(x, y)
    map.anisotropy = Math.min(8, anisotropy)
    if (isColor) map.encoding = THREE.sRGBEncoding
    return map
  }
  return {
    wood: load(new URL('../assets/table/wood-color.webp', import.meta.url).href, 1 / 1900, 1 / 390, true),
    woodNormal: load(new URL('../assets/table/wood-normal.webp', import.meta.url).href, 1 / 1900, 1 / 390),
    cloth: load(new URL('../assets/table/cloth-pile.webp', import.meta.url).href, 1 / 22, 1 / 22),
    leather: load(new URL('../assets/table/leather-color.webp', import.meta.url).href, 1 / 160, 1 / 160, true),
    leatherNormal: load(new URL('../assets/table/leather-normal.webp', import.meta.url).href, 1 / 160, 1 / 160),
    floor: load(new URL('../assets/table/floor-color.webp', import.meta.url).href, 19, 19, true),
  }
}

export function createRoomShell(floor, maps) {
  const arena = new THREE.Group()
  arena.name = 'championship-arena'

  // 克鲁斯堡风格的深邃赛场剧场墙面：压暗四周让球台成为视觉焦点
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x141a1d),
    roughness: 0.96,
    envMapIntensity: 0.06,
  })
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x3a2a22),
    map: maps.wood,
    roughness: 0.56,
    envMapIntensity: 0.16,
  })
  const capMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x281c15),
    roughness: 0.42,
    envMapIntensity: 0.24,
  })
  const brassTrimMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0xc59f5b),
    roughness: 0.3,
    metalness: 0.82,
    envMapIntensity: 0.45,
  })
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x192320),
    roughness: 0.92,
    envMapIntensity: 0.08,
  })

  function mountedBoard(width, height, material, x, y, z, measure = false) {
    const geometry = new THREE.PlaneGeometry(width, height)
    if (measure) {
      const uv = geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width, uv.getY(i) * height)
    }
    const part = new THREE.Mesh(geometry, material)
    part.position.set(x, y, z)
    return part
  }

  for (const [width, x, z, angle] of [
    [15600, 0, -6400, 0], [15600, 0, 6400, Math.PI],
    [12800, -7800, 0, Math.PI / 2], [12800, 7800, 0, -Math.PI / 2],
  ]) {
    const wall = new THREE.Group()
    wall.position.set(x, floor, z)
    wall.rotation.y = angle
    wall.add(
      mountedBoard(width, 4200, wallMaterial, 0, 2100, 0),
      mountedBoard(width, 1080, panelMaterial, 0, 540, 2, true),
      mountedBoard(width, 46, capMaterial, 0, 1086, 6),
      mountedBoard(width, 14, brassTrimMaterial, 0, 1116, 8),
      mountedBoard(width, 72, capMaterial, 0, 36, 6),
    )
    arena.add(wall)
  }

  // 赛场低矮围挡（围绕球台四周的转播区边界，增加纵深感且不遮挡低角度视角）
  const bw = 6200
  const bd = 4600
  const bh = 460
  const thick = 36
  for (const [w, d, x, z] of [
    [bw, thick, 0, -bd / 2],
    [bw, thick, 0, bd / 2],
    [thick, bd, -bw / 2, 0],
    [thick, bd, bw / 2, 0],
  ]) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), barrierMaterial)
    body.position.set(x, floor + bh / 2, z)
    arena.add(body)
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(w + 6, 16, d + 6),
      brassTrimMaterial,
    )
    rail.position.set(x, floor + bh + 8, z)
    arena.add(rail)
  }

  return arena
}


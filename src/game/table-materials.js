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
    cloth: load(new URL('../assets/table/cloth-pile.webp', import.meta.url).href, 1 / 230, 1 / 230),
    leather: load(new URL('../assets/table/leather-color.webp', import.meta.url).href, 1 / 160, 1 / 160, true),
    leatherNormal: load(new URL('../assets/table/leather-normal.webp', import.meta.url).href, 1 / 160, 1 / 160),
    floor: load(new URL('../assets/table/floor-color.webp', import.meta.url).href, 19, 19, true),
  }
}

export function createRoomShell(floor, maps) {
  const walls = new THREE.Group()
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x333b34),
    roughness: 1,
    envMapIntensity: 0.08,
  })
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x786753),
    map: maps.wood,
    roughness: 0.53,
    envMapIntensity: 0.22,
  })
  const capMaterial = new THREE.MeshStandardMaterial({
    color: surfaceColor(0x4a3528),
    roughness: 0.45,
    envMapIntensity: 0.27,
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
    [13000, 0, -5300, 0], [13000, 0, 5300, Math.PI],
    [10600, -6500, 0, Math.PI / 2], [10600, 6500, 0, -Math.PI / 2],
  ]) {
    const wall = new THREE.Group()
    wall.position.set(x, floor, z)
    wall.rotation.y = angle
    wall.add(
      mountedBoard(width, 3500, wallMaterial, 0, 1750, 0),
      mountedBoard(width, 1110, panelMaterial, 0, 555, 1, true),
      mountedBoard(width, 47, capMaterial, 0, 1116, 3),
      mountedBoard(width, 68, capMaterial, 0, 34, 3),
    )
    walls.add(wall)
  }
  return walls
}

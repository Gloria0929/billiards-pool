import { Matrix4, Mesh } from 'three'
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// 合并同材质的静态部件，保留原顶点、贴图坐标和材质。
export function batchStaticMeshes(root) {
  root.updateMatrixWorld(true)
  const inverse = new Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map()
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || mesh.material.transparent) return
    const attributes = Object.entries(mesh.geometry.attributes)
      .map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`).sort().join(',')
    const key = [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, attributes].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(mesh)
  })
  const removed = new Set()
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue
    const geometries = meshes.map((mesh) => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      return geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    })
    const merged = BufferGeometryUtils.mergeBufferGeometries(geometries)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) continue
    const first = meshes[0]
    const batch = new Mesh(merged, first.material)
    batch.castShadow = first.castShadow
    batch.receiveShadow = first.receiveShadow
    batch.renderOrder = first.renderOrder
    meshes.forEach((mesh) => { removed.add(mesh.geometry); mesh.parent.remove(mesh) })
    root.add(batch)
  }
  root.traverse((mesh) => { if (mesh.geometry) removed.delete(mesh.geometry) })
  removed.forEach((geometry) => geometry.dispose())
  return root
}

import * as THREE from 'three'
import { Brush, Evaluator } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

export function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return brush.geometry as unknown as THREE.BufferGeometry
}

export function csgMaterials(brush: Brush): THREE.Material[] {
  const mat = (brush as any).material
  return Array.isArray(mat) ? mat : [mat]
}

export const csgEvaluator = new Evaluator()
csgEvaluator.useGroups = true
;(csgEvaluator as any).consolidateGroups = false
csgEvaluator.attributes = ['position', 'normal', 'uv']

export function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

export function prepareBrushForCSG(brush: Brush) {
  computeGeometryBoundsTree(brush.geometry)
  brush.updateMatrixWorld()
}

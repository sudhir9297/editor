import type { SkylightNode } from '@pascal-app/core'
import * as THREE from 'three'
import { Brush, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { csgEvaluator, csgGeometry } from '../../lib/csg-utils'

const visibleDummyMat = new THREE.MeshBasicMaterial()

export function paneSize(value: number): number {
  return Math.max(0.02, value)
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function buildLanternGlassGeometry(
  width: number,
  depth: number,
  lanternHeight: number,
  topScale: number,
): THREE.BufferGeometry {
  const baseHalfW = paneSize(width) / 2
  const baseHalfD = paneSize(depth) / 2
  const resolvedTopScale = clamp01(topScale)
  const topHalfW = baseHalfW * resolvedTopScale
  const topHalfD = baseHalfD * resolvedTopScale
  const topY = Math.max(0.05, lanternHeight)

  const positions =
    resolvedTopScale <= 1e-4
      ? [
          -baseHalfW, 0, baseHalfD, baseHalfW, 0, baseHalfD, 0, topY, 0,
          baseHalfW, 0, baseHalfD, baseHalfW, 0, -baseHalfD, 0, topY, 0,
          baseHalfW, 0, -baseHalfD, -baseHalfW, 0, -baseHalfD, 0, topY, 0,
          -baseHalfW, 0, -baseHalfD, -baseHalfW, 0, baseHalfD, 0, topY, 0,
        ]
      : [
          -baseHalfW, 0, baseHalfD, baseHalfW, 0, baseHalfD, topHalfW, topY, topHalfD, -topHalfW, topY, topHalfD,
          baseHalfW, 0, baseHalfD, baseHalfW, 0, -baseHalfD, topHalfW, topY, -topHalfD, topHalfW, topY, topHalfD,
          baseHalfW, 0, -baseHalfD, -baseHalfW, 0, -baseHalfD, -topHalfW, topY, -topHalfD, topHalfW, topY, -topHalfD,
          -baseHalfW, 0, -baseHalfD, -baseHalfW, 0, baseHalfD, -topHalfW, topY, topHalfD, -topHalfW, topY, -topHalfD,
        ]
  const indices =
    resolvedTopScale <= 1e-4
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15]

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function buildFrameGeometry({
  curb,
  curbHeight,
  frameDepth,
  frameThickness,
  height,
  width,
}: Pick<
  SkylightNode,
  'curb' | 'curbHeight' | 'frameDepth' | 'frameThickness' | 'height' | 'width'
>): THREE.BufferGeometry | null {
  const w = width
  const h = height
  const ft = frameThickness
  const fd = frameDepth
  const hasCurb = curb ?? false
  const curbH = hasCurb ? Math.max(0, curbHeight ?? 0.1) : 0

  const outerW = w + 2 * ft
  const outerH = h + 2 * ft
  const totalDepth = fd + curbH

  const outerBox = new THREE.BoxGeometry(outerW, totalDepth, outerH)
  const innerBox = new THREE.BoxGeometry(w, totalDepth + 0.02, h)

  const setupGeo = (geo: THREE.BufferGeometry) => {
    const ic = geo.getIndex()?.count ?? 0
    geo.clearGroups()
    if (ic > 0) geo.addGroup(0, ic, 0)
    ;(geo as any).computeBoundsTree = computeBoundsTree
    ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })
  }
  setupGeo(outerBox)
  setupGeo(innerBox)

  let frameGeo: THREE.BufferGeometry
  try {
    const outerBrush = new Brush(outerBox, visibleDummyMat as any)
    outerBrush.updateMatrixWorld()
    const innerBrush = new Brush(innerBox, visibleDummyMat as any)
    innerBrush.updateMatrixWorld()
    const result = csgEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION) as Brush
    frameGeo = csgGeometry(result).clone()
    const ic = frameGeo.getIndex()?.count ?? 0
    frameGeo.clearGroups()
    if (ic > 0) frameGeo.addGroup(0, ic, 0)
    outerBox.dispose()
    innerBox.dispose()
    result.geometry.dispose()
  } catch (e) {
    console.error('Skylight frame CSG failed:', e)
    outerBox.dispose()
    innerBox.dispose()
    return null
  }

  frameGeo.translate(0, -totalDepth / 2 + curbH, 0)

  return frameGeo
}

import {
  type AnyNodeId,
  type DormerNode,
  type RoofSegmentNode,
  getEffectiveDormerSurfaceMaterial,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import { generateDormerGeometry, getDormerSkirtWindowDims } from '../../../systems/roof/roof-system'

const dormerGlassMaterial = new THREE.MeshStandardMaterial({
  color: 0x9c_c8_e6,
  transparent: true,
  opacity: 0.45,
  roughness: 0.05,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

// Three distinct dormer materials: wall, side, roof top
const dormerWallMat = new THREE.MeshStandardMaterial({ color: 0xd9_d6_cf, roughness: 0.9, side: THREE.DoubleSide })
const dormerSideMat = new THREE.MeshStandardMaterial({ color: 0x3a_3a_3a, roughness: 0.85, side: THREE.FrontSide })
const dormerRoofMat = new THREE.MeshStandardMaterial({ color: 0x4b_3a_30, roughness: 0.85, side: THREE.FrontSide })

// Geometry slots 0-4 mapped to the 3 materials:
//   0 = Wall          → dormerWallMat
//   1 = Deck (side)   → dormerSideMat
//   2 = Interior      → dormerWallMat
//   3 = Roof shingle  → dormerRoofMat
//   4 = Gable wall    → dormerWallMat
const dormerMaterials: THREE.Material[] = [
  dormerWallMat,
  dormerSideMat,
  dormerWallMat,
  dormerRoofMat,
  dormerWallMat,
]
export const DORMER_GABLE_MATERIAL_INDEX = 4

type WindowGeometries = {
  frameBars: { geo: THREE.BoxGeometry; pos: [number, number, number] }[]
  glassPanes: { geo: THREE.BoxGeometry; pos: [number, number, number] }[]
  sill: THREE.BoxGeometry | null
  sillPos: [number, number, number]
}

// Frame grows INWARD from the CSG cut edge. The cut opening is winW×winH.
// Frame bars sit inside that opening. Dividers subdivide the inner area into
// a cols×rows grid; individual glass panes fill each cell.
function buildWindowGeometries(
  winW: number,
  winH: number,
  ft: number,
  fd: number,
  cols: number,
  rows: number,
  dt: number,
  showSill: boolean,
  sillDepth: number,
  sillThickness: number,
): WindowGeometries {
  const safeFt = Math.max(0.001, ft)
  const safeDt = Math.max(0.001, dt)
  const innerW = Math.max(0.01, winW - 2 * safeFt)
  const innerH = Math.max(0.01, winH - 2 * safeFt)
  const hw = winW / 2
  const hh = winH / 2
  const ht = safeFt / 2

  const frameBars: WindowGeometries['frameBars'] = []

  // Outer frame: top, bottom, left, right
  frameBars.push({ geo: new THREE.BoxGeometry(winW, safeFt, fd), pos: [0, hh - ht, 0] })
  frameBars.push({ geo: new THREE.BoxGeometry(winW, safeFt, fd), pos: [0, -hh + ht, 0] })
  frameBars.push({ geo: new THREE.BoxGeometry(safeFt, innerH, fd), pos: [-hw + ht, 0, 0] })
  frameBars.push({ geo: new THREE.BoxGeometry(safeFt, innerH, fd), pos: [hw - ht, 0, 0] })

  // Column dividers (vertical bars inside the inner area)
  const colDividerCount = cols - 1
  const totalColDividerW = colDividerCount * safeDt
  const paneAreaW = Math.max(0.01, innerW - totalColDividerW)
  const paneW = paneAreaW / cols

  for (let c = 1; c < cols; c++) {
    const x = -innerW / 2 + c * paneW + (c - 0.5) * safeDt
    frameBars.push({ geo: new THREE.BoxGeometry(safeDt, innerH, fd), pos: [x, 0, 0] })
  }

  // Row dividers (horizontal bars inside the inner area)
  const rowDividerCount = rows - 1
  const totalRowDividerH = rowDividerCount * safeDt
  const paneAreaH = Math.max(0.01, innerH - totalRowDividerH)
  const paneH = paneAreaH / rows

  for (let r = 1; r < rows; r++) {
    const y = -innerH / 2 + r * paneH + (r - 0.5) * safeDt
    frameBars.push({ geo: new THREE.BoxGeometry(innerW, safeDt, fd), pos: [0, y, 0] })
  }

  // Glass panes — one per grid cell
  const glassPanes: WindowGeometries['glassPanes'] = []
  const glassW = Math.max(0.01, paneW)
  const glassH = Math.max(0.01, paneH)
  const glassGeo = new THREE.BoxGeometry(glassW, glassH, 0.008)

  for (let c = 0; c < cols; c++) {
    const cx = -innerW / 2 + paneW / 2 + c * (paneW + safeDt)
    for (let r = 0; r < rows; r++) {
      const cy = -innerH / 2 + paneH / 2 + r * (paneH + safeDt)
      glassPanes.push({ geo: glassGeo, pos: [cx, cy, 0] })
    }
  }

  let sill: THREE.BoxGeometry | null = null
  if (showSill) {
    sill = new THREE.BoxGeometry(winW + 0.02, sillThickness, sillDepth + fd)
  }

  return {
    frameBars,
    glassPanes,
    sill,
    sillPos: [0, -hh - sillThickness / 2, sillDepth / 2],
  }
}

export const DormerRenderer = ({ node: storeNode }: { node: DormerNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'dormer', ref)
  const handlers = useNodeEvents(storeNode, 'dormer')

  useFollowSegmentDrag(ref, storeNode.roofSegmentId)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as DormerNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const resolvedMaterials = useMemo(() => {
    const top = getEffectiveDormerSurfaceMaterial(node, 'top')
    const side = getEffectiveDormerSurfaceMaterial(node, 'side')
    const wall = getEffectiveDormerSurfaceMaterial(node, 'wall')

    const resolve = (spec: { material?: DormerNode['material']; materialPreset?: string }) => {
      if (spec.materialPreset) return createMaterialFromPresetRef(spec.materialPreset)
      if (spec.material) return createMaterial(spec.material)
      return null
    }

    const topMat = resolve(top)
    const sideMat = resolve(side)
    const wallMat = resolve(wall)

    if (!(topMat || sideMat || wallMat)) return null

    const w = wallMat ?? dormerWallMat
    const s = sideMat ?? dormerSideMat
    const t = topMat ?? dormerRoofMat

    // Slots: 0=wall, 1=side, 2=interior(wall), 3=roof, 4=gable(wall)
    return [w, s, w, t, w] as THREE.Material[]
  }, [
    node.material, node.materialPreset,
    node.topMaterial, node.topMaterialPreset,
    node.sideMaterial, node.sideMaterialPreset,
    node.wallMaterial, node.wallMaterialPreset,
  ])

  const material = resolvedMaterials ?? dormerMaterials

  const frameSideMat = useMemo(() => {
    if (resolvedMaterials) return resolvedMaterials[1]!
    return dormerSideMat
  }, [resolvedMaterials])

  const geometry = useMemo(
    () => (segment ? generateDormerGeometry(node, segment) : null),
    [
      segment,
      node.id,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.position[0],
      node.position[1],
      node.position[2],
      node.rotation,
      node.windowWidth,
      node.windowHeight,
      node.windowOffsetX,
      node.windowOffsetY,
    ],
  )

  useEffect(() => {
    return () => geometry?.dispose()
  }, [geometry])

  const skirtWin = useMemo(
    () => getDormerSkirtWindowDims(node),
    [node.width, node.windowWidth, node.windowHeight, node.windowOffsetX, node.windowOffsetY],
  )

  const ft = node.windowFrameThickness ?? 0.05
  const fd = node.windowFrameDepth ?? 0.06
  const cols = node.windowColumns ?? 1
  const rows = node.windowRows ?? 1
  const dt = node.windowDividerThickness ?? 0.02
  const showSill = node.windowSill ?? true
  const sillDepth = node.windowSillDepth ?? 0.08
  const sillThickness = node.windowSillThickness ?? 0.03

  const winGeo = useMemo(() => {
    return buildWindowGeometries(
      skirtWin.width, skirtWin.height, ft, fd, cols, rows, dt,
      showSill, sillDepth, sillThickness,
    )
  }, [skirtWin.width, skirtWin.height, ft, fd, cols, rows, dt, showSill, sillDepth, sillThickness])

  useEffect(() => {
    return () => {
      const disposed = new Set<THREE.BufferGeometry>()
      for (const bar of winGeo.frameBars) {
        if (!disposed.has(bar.geo)) { bar.geo.dispose(); disposed.add(bar.geo) }
      }
      for (const pane of winGeo.glassPanes) {
        if (!disposed.has(pane.geo)) { pane.geo.dispose(); disposed.add(pane.geo) }
      }
      winGeo.sill?.dispose()
    }
  }, [winGeo])

  const gableZ = node.depth / 2
  const winX = skirtWin.offsetX
  const winY = skirtWin.centerY
  const wallZ = gableZ

  if (!(segment && geometry)) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      <group position={[node.position[0], node.position[1], node.position[2]]}>
        <group rotation-y={node.rotation}>
          <mesh
            castShadow
            geometry={geometry}
            material={material}
            name="dormer-body"
            receiveShadow
          />
          {/* Window assembly */}
          <group name="dormer-skirt-window" position={[winX, winY, wallZ]}>
            {/* Glass panes */}
            {winGeo.glassPanes.map((pane, i) => (
              <mesh
                geometry={pane.geo}
                key={`glass-${i}`}
                material={dormerGlassMaterial}
                position={pane.pos}
              />
            ))}
            {/* Frame + divider bars */}
            {winGeo.frameBars.map((bar, i) => (
              <mesh
                geometry={bar.geo}
                key={`bar-${i}`}
                material={frameSideMat}
                position={bar.pos}
              />
            ))}
          </group>
          {/* Sill */}
          {showSill && winGeo.sill && (
            <mesh
              geometry={winGeo.sill}
              material={frameSideMat}
              name="dormer-skirt-sill"
              position={[
                winX + winGeo.sillPos[0],
                winY + winGeo.sillPos[1],
                wallZ + winGeo.sillPos[2],
              ]}
            />
          )}
        </group>
      </group>
    </group>
  )
}

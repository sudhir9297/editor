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
import { generateDormerGeometry, getDormerExposedFaces, getDormerSkirtWindowDims } from '../../../systems/roof/roof-system'

const dormerGlassMaterial = new THREE.MeshStandardMaterial({
  color: 0x9c_c8_e6,
  transparent: true,
  opacity: 0.45,
  roughness: 0.05,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

// Three distinct dormer materials: wall, side, roof top
const dormerWallMat = new THREE.MeshStandardMaterial({ color: 0xff_ff_ff, roughness: 0.9, side: THREE.DoubleSide })
const dormerSideMat = new THREE.MeshStandardMaterial({ color: 0xff_ff_ff, roughness: 0.9, side: THREE.FrontSide })
const dormerRoofMat = new THREE.MeshStandardMaterial({ color: 0xff_ff_ff, roughness: 0.9, side: THREE.FrontSide })

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
  frameBars: { geo: THREE.BufferGeometry; pos: [number, number, number] }[]
  glassPanes: { geo: THREE.BufferGeometry; pos: [number, number, number] }[]
  sill: THREE.BoxGeometry | null
  sillPos: [number, number, number]
}

type DormerWindowShape = 'rectangle' | 'rounded' | 'arch'

function makeArchShape(hw: number, hh: number, archHeight: number): THREE.Shape {
  const clampedArch = Math.min(Math.max(archHeight, 0.01), Math.max(hh * 2, 0.01))
  const springY = hh - clampedArch
  const segments = 32
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -hh)
  shape.lineTo(hw, -hh)
  shape.lineTo(hw, springY)
  for (let i = 1; i <= segments; i++) {
    const x = hw + (-hw - hw) * (i / segments)
    const t = Math.min(Math.abs(x) / Math.max(hw, 1e-6), 1)
    const y = springY + clampedArch * Math.sqrt(Math.max(1 - t * t, 0))
    shape.lineTo(x, y)
  }
  shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

function normalizeRadii(
  radii: [number, number, number, number],
  w: number,
  h: number,
): [number, number, number, number] {
  const r = radii.map((v) => Math.max(v, 0)) as [number, number, number, number]
  const scale = Math.min(
    1,
    Math.max(w, 0) / Math.max(r[0] + r[1], 1e-6),
    Math.max(w, 0) / Math.max(r[3] + r[2], 1e-6),
    Math.max(h, 0) / Math.max(r[0] + r[3], 1e-6),
    Math.max(h, 0) / Math.max(r[1] + r[2], 1e-6),
  )
  if (scale >= 1) return r
  return r.map((v) => v * scale) as [number, number, number, number]
}

function makeRoundedShape(hw: number, hh: number, radii: [number, number, number, number]): THREE.Shape {
  const [tl, tr, br, bl] = normalizeRadii(radii, hw * 2, hh * 2)
  const shape = new THREE.Shape()
  shape.moveTo(-hw + bl, -hh)
  shape.lineTo(hw - br, -hh)
  if (br > 0) shape.absarc(hw - br, -hh + br, br, -Math.PI / 2, 0, false)
  else shape.lineTo(hw, -hh)
  shape.lineTo(hw, hh - tr)
  if (tr > 0) shape.absarc(hw - tr, hh - tr, tr, 0, Math.PI / 2, false)
  else shape.lineTo(hw, hh)
  shape.lineTo(-hw + tl, hh)
  if (tl > 0) shape.absarc(-hw + tl, hh - tl, tl, Math.PI / 2, Math.PI, false)
  else shape.lineTo(-hw, hh)
  shape.lineTo(-hw, -hh + bl)
  if (bl > 0) shape.absarc(-hw + bl, -hh + bl, bl, Math.PI, (3 * Math.PI) / 2, false)
  else shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

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
  shape: DormerWindowShape = 'rectangle',
  archHeight = 0.35,
  cornerRadii: [number, number, number, number] = [0.15, 0.15, 0.15, 0.15],
): WindowGeometries {
  const safeFt = Math.max(0.001, ft)
  const safeDt = Math.max(0.001, dt)
  const innerW = Math.max(0.01, winW - 2 * safeFt)
  const innerH = Math.max(0.01, winH - 2 * safeFt)
  const hw = winW / 2
  const hh = winH / 2
  const ht = safeFt / 2

  const frameBars: WindowGeometries['frameBars'] = []
  const glassPanes: WindowGeometries['glassPanes'] = []

  if (shape === 'arch' || shape === 'rounded') {
    // Shaped frame: extrude outer minus inner hole
    const insetRadii = cornerRadii.map((r) => Math.max(r - safeFt, 0)) as [number, number, number, number]
    const outerShape =
      shape === 'arch'
        ? makeArchShape(hw, hh, archHeight)
        : makeRoundedShape(hw, hh, cornerRadii)

    const innerHole =
      shape === 'arch'
        ? makeArchShape(hw - safeFt, hh - safeFt, Math.max(archHeight - safeFt, 0.01))
        : makeRoundedShape(hw - safeFt, hh - safeFt, insetRadii)

    outerShape.holes.push(innerHole)
    const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: fd,
      bevelEnabled: false,
      curveSegments: 24,
    })
    frameGeo.translate(0, 0, -fd / 2)
    frameBars.push({ geo: frameGeo, pos: [0, 0, 0] })

    // Divider bars (still boxes — they sit inside the inner area)
    const colDividerCount = cols - 1
    const totalColDividerW = colDividerCount * safeDt
    const paneAreaW = Math.max(0.01, innerW - totalColDividerW)
    const paneW = paneAreaW / cols

    for (let c = 1; c < cols; c++) {
      const x = -innerW / 2 + c * paneW + (c - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(safeDt, innerH, fd), pos: [x, 0, 0] })
    }

    const rowDividerCount = rows - 1
    const totalRowDividerH = rowDividerCount * safeDt
    const paneAreaH = Math.max(0.01, innerH - totalRowDividerH)
    const paneH = paneAreaH / rows

    for (let r = 1; r < rows; r++) {
      const y = -innerH / 2 + r * paneH + (r - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(innerW, safeDt, fd), pos: [0, y, 0] })
    }

    // Glass: single shaped pane filling the inner area
    const glassShape =
      shape === 'arch'
        ? makeArchShape(hw - safeFt, hh - safeFt, Math.max(archHeight - safeFt, 0.01))
        : makeRoundedShape(hw - safeFt, hh - safeFt, insetRadii)

    const glassGeo = new THREE.ExtrudeGeometry(glassShape, {
      depth: 0.008,
      bevelEnabled: false,
      curveSegments: 24,
    })
    glassGeo.translate(0, 0, -0.004)
    glassPanes.push({ geo: glassGeo, pos: [0, 0, 0] })
  } else {
    // Rectangle: box-based frame bars
    frameBars.push({ geo: new THREE.BoxGeometry(winW, safeFt, fd), pos: [0, hh - ht, 0] })
    frameBars.push({ geo: new THREE.BoxGeometry(winW, safeFt, fd), pos: [0, -hh + ht, 0] })
    frameBars.push({ geo: new THREE.BoxGeometry(safeFt, innerH, fd), pos: [-hw + ht, 0, 0] })
    frameBars.push({ geo: new THREE.BoxGeometry(safeFt, innerH, fd), pos: [hw - ht, 0, 0] })

    const colDividerCount = cols - 1
    const totalColDividerW = colDividerCount * safeDt
    const paneAreaW = Math.max(0.01, innerW - totalColDividerW)
    const paneW = paneAreaW / cols

    for (let c = 1; c < cols; c++) {
      const x = -innerW / 2 + c * paneW + (c - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(safeDt, innerH, fd), pos: [x, 0, 0] })
    }

    const rowDividerCount = rows - 1
    const totalRowDividerH = rowDividerCount * safeDt
    const paneAreaH = Math.max(0.01, innerH - totalRowDividerH)
    const paneH = paneAreaH / rows

    for (let r = 1; r < rows; r++) {
      const y = -innerH / 2 + r * paneH + (r - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(innerW, safeDt, fd), pos: [0, y, 0] })
    }

    const glassW = Math.max(0.01, paneAreaW / cols)
    const glassH = Math.max(0.01, paneAreaH / rows)
    const glassGeo = new THREE.BoxGeometry(glassW, glassH, 0.008)

    for (let c = 0; c < cols; c++) {
      const cx = -innerW / 2 + (paneAreaW / cols) / 2 + c * ((paneAreaW / cols) + safeDt)
      for (let r = 0; r < rows; r++) {
        const cy = -innerH / 2 + (paneAreaH / rows) / 2 + r * ((paneAreaH / rows) + safeDt)
        glassPanes.push({ geo: glassGeo, pos: [cx, cy, 0] })
      }
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
      node.windowShape,
      node.windowArchHeight,
      node.windowCornerRadius,
      node.windowRadiusMode,
      node.windowCornerRadii?.[0],
      node.windowCornerRadii?.[1],
      node.windowCornerRadii?.[2],
      node.windowCornerRadii?.[3],
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
  const winShape = (node.windowShape ?? 'rectangle') as DormerWindowShape
  const archH = node.windowArchHeight ?? 0.35
  const cornerR = node.windowCornerRadius ?? 0.15
  const radiusMode = node.windowRadiusMode ?? 'all'
  const individualRadii = node.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15]
  const resolvedRadii: [number, number, number, number] =
    radiusMode === 'individual' ? individualRadii as [number, number, number, number] : [cornerR, cornerR, cornerR, cornerR]

  const winGeo = useMemo(() => {
    return buildWindowGeometries(
      skirtWin.width, skirtWin.height, ft, fd, cols, rows, dt,
      showSill, sillDepth, sillThickness, winShape, archH, resolvedRadii,
    )
  }, [skirtWin.width, skirtWin.height, ft, fd, cols, rows, dt, showSill, sillDepth, sillThickness, winShape, archH, ...resolvedRadii])

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

  const gableHalfZ = node.depth / 2
  const winX = skirtWin.offsetX
  const winY = skirtWin.centerY

  const exposed = useMemo(
    () => (segment ? getDormerExposedFaces(node, segment) : { front: true, back: false }),
    [
      segment,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.position[0],
      node.position[1],
      node.position[2],
    ],
  )

  if (!(segment && geometry)) return null

  const renderWindowAssembly = (zPos: number, keyPrefix: string) => (
    <>
      <group name={`dormer-skirt-window-${keyPrefix}`} position={[winX, winY, zPos]}>
        {winGeo.glassPanes.map((pane, i) => (
          <mesh
            geometry={pane.geo}
            key={`${keyPrefix}-glass-${i}`}
            material={dormerGlassMaterial}
            position={pane.pos}
          />
        ))}
        {winGeo.frameBars.map((bar, i) => (
          <mesh
            geometry={bar.geo}
            key={`${keyPrefix}-bar-${i}`}
            material={frameSideMat}
            position={bar.pos}
          />
        ))}
      </group>
      {showSill && winGeo.sill && (
        <mesh
          geometry={winGeo.sill}
          key={`${keyPrefix}-sill`}
          material={frameSideMat}
          name={`dormer-skirt-sill-${keyPrefix}`}
          position={[
            winX + winGeo.sillPos[0],
            winY + winGeo.sillPos[1],
            zPos + winGeo.sillPos[2],
          ]}
        />
      )}
    </>
  )

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
          {exposed.front && renderWindowAssembly(gableHalfZ, 'front')}
          {exposed.back && renderWindowAssembly(-gableHalfZ, 'back')}
        </group>
      </group>
    </group>
  )
}

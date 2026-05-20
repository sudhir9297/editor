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
import { type DormerWindowShape, type WindowGeometries, buildWindowGeometries } from '../../../systems/dormer/dormer-window-geometry'
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
    node.roofType,
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

  const winW = skirtWin.width
  const winH = skirtWin.height
  const winShape: DormerWindowShape = (node.windowShape ?? 'rectangle') as DormerWindowShape
  const archH = node.windowArchHeight ?? 0.35
  const cornerR = node.windowCornerRadius ?? 0.15
  const radiusMode = node.windowRadiusMode ?? 'all'
  const individualRadii = node.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15]
  const resolvedRadii: [number, number, number, number] =
    radiusMode === 'individual' ? individualRadii as [number, number, number, number] : [cornerR, cornerR, cornerR, cornerR]

  const winGeo = useMemo(() => {
    return buildWindowGeometries(
      winW, winH, ft, fd, cols, rows, dt,
      false, 0, 0, winShape, archH, resolvedRadii,
    )
  }, [winW, winH, ft, fd, cols, rows, dt, winShape, archH, ...resolvedRadii])

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

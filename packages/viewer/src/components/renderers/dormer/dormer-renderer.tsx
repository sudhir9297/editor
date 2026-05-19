import {
  type AnyNodeId,
  type DormerNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'

const defaultWallMaterial = new MeshStandardNodeMaterial({
  color: 0xe8_e2_d4,
  roughness: 0.85,
  metalness: 0,
})

const defaultRoofMaterial = new MeshStandardNodeMaterial({
  color: 0x55_55_55,
  roughness: 0.7,
  metalness: 0,
})

const defaultFrameMaterial = new MeshStandardNodeMaterial({
  color: 0x33_33_33,
  roughness: 0.5,
  metalness: 0.2,
})

const defaultGlassMaterial = new MeshPhysicalNodeMaterial({
  color: 0xdf_f7_ff,
  roughness: 0.02,
  metalness: 0,
  transparent: true,
  opacity: 0.32,
  transmission: 0.9,
  ior: 1.5,
  thickness: 0.02,
  reflectivity: 0.7,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  side: THREE.DoubleSide,
})

function buildFrontWallGeometry(node: DormerNode): THREE.BufferGeometry {
  const halfW = node.width / 2
  const gableRise = halfW * Math.tan((node.roofPitchDeg * Math.PI) / 180)

  const shape = new THREE.Shape()
  shape.moveTo(-halfW, 0)
  shape.lineTo(halfW, 0)
  shape.lineTo(halfW, node.frontWallHeight)
  shape.lineTo(0, node.frontWallHeight + gableRise)
  shape.lineTo(-halfW, node.frontWallHeight)
  shape.lineTo(-halfW, 0)

  if (node.hasWindow) {
    const ww = Math.min(node.windowWidth, node.width - 2 * node.wallThickness - 0.05)
    const wh = Math.min(node.windowHeight, node.frontWallHeight - node.windowSillHeight - 0.05)
    if (ww > 0.1 && wh > 0.1) {
      // Holes for THREE.Shape must be wound clockwise (opposite of the outer
      // CCW path) to subtract correctly from the extruded geometry.
      const hole = new THREE.Path()
      const halfWw = ww / 2
      const yBot = node.windowSillHeight
      const yTop = node.windowSillHeight + wh
      hole.moveTo(-halfWw, yBot)
      hole.lineTo(-halfWw, yTop)
      hole.lineTo(halfWw, yTop)
      hole.lineTo(halfWw, yBot)
      hole.lineTo(-halfWw, yBot)
      shape.holes.push(hole)
    }
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: node.wallThickness,
    bevelEnabled: false,
  })
  // ExtrudeGeometry extrudes from z=0 to z=wallThickness.
  // Front face of the dormer is at z = -depth/2; wall extends inward (+z).
  geo.translate(0, 0, -node.depth / 2)
  return geo
}

function buildCheekWallGeometry(node: DormerNode, side: 'left' | 'right'): THREE.BufferGeometry {
  // Rectangular wall extruded in X. Extends from below the base (so it hides
  // inside the roof cut) up to frontWallHeight. The dormer roof panels cover
  // the eave from above.
  const dropBelow = 0.5
  const heightTotal = node.frontWallHeight + dropBelow
  const geo = new THREE.BoxGeometry(node.wallThickness, heightTotal, node.depth)
  const xCenter =
    side === 'left'
      ? -node.width / 2 + node.wallThickness / 2
      : node.width / 2 - node.wallThickness / 2
  geo.translate(xCenter, node.frontWallHeight / 2 - dropBelow / 2, 0)
  return geo
}

function RoofPanel({
  material,
  node,
  side,
}: {
  material: THREE.Material
  node: DormerNode
  side: 'left' | 'right'
}) {
  const pitch = (node.roofPitchDeg * Math.PI) / 180
  const halfW = node.width / 2
  const slopeLen = halfW / Math.cos(pitch)
  const sign = side === 'left' ? -1 : 1
  // Center of the slope line between ridge top and eave
  const midX = sign * (halfW / 2)
  const midY = node.frontWallHeight + (halfW * Math.tan(pitch)) / 2

  // Box geometry: long axis = slope, thickness in Y, depth along Z.
  // Rotate around Z by +pitch for left panel (+X end up), -pitch for right.
  const rotZ = side === 'left' ? pitch : -pitch
  const panelDepth = node.depth + node.roofOverhangFront * 2

  return (
    <group
      position={[midX, midY, node.roofOverhangFront / 2 - node.roofOverhangFront / 2]}
      rotation={[0, 0, rotZ]}
    >
      <mesh castShadow material={material} name="dormer-roof" receiveShadow>
        <boxGeometry
          args={[slopeLen + node.roofOverhangSides, node.roofThickness, panelDepth]}
        />
      </mesh>
    </group>
  )
}

function Window({
  frameMaterial,
  glassMaterial,
  node,
}: {
  frameMaterial: THREE.Material
  glassMaterial: THREE.Material
  node: DormerNode
}) {
  const ww = Math.min(node.windowWidth, node.width - 2 * node.wallThickness - 0.05)
  const wh = Math.min(node.windowHeight, node.frontWallHeight - node.windowSillHeight - 0.05)
  if (ww <= 0.1 || wh <= 0.1) return null

  const ft = node.windowFrameThickness
  const fd = node.windowFrameDepth
  const cy = node.windowSillHeight + wh / 2
  // Wall front face at z = -depth/2. Frame sits in the wall, centered in thickness.
  const cz = -node.depth / 2 + node.wallThickness / 2

  // Frame: 4 thin bars around the opening (outside the hole)
  const halfWw = ww / 2
  const halfWh = wh / 2
  return (
    <group position={[0, 0, 0]}>
      {/* Top bar */}
      <mesh
        material={frameMaterial}
        name="dormer-window-frame"
        position={[0, cy + halfWh + ft / 2, cz]}
      >
        <boxGeometry args={[ww + 2 * ft, ft, fd]} />
      </mesh>
      {/* Bottom bar */}
      <mesh
        material={frameMaterial}
        name="dormer-window-frame"
        position={[0, cy - halfWh - ft / 2, cz]}
      >
        <boxGeometry args={[ww + 2 * ft, ft, fd]} />
      </mesh>
      {/* Left bar */}
      <mesh
        material={frameMaterial}
        name="dormer-window-frame"
        position={[-halfWw - ft / 2, cy, cz]}
      >
        <boxGeometry args={[ft, wh, fd]} />
      </mesh>
      {/* Right bar */}
      <mesh
        material={frameMaterial}
        name="dormer-window-frame"
        position={[halfWw + ft / 2, cy, cz]}
      >
        <boxGeometry args={[ft, wh, fd]} />
      </mesh>
      {/* Glass pane */}
      <mesh material={glassMaterial} name="dormer-window-glass" position={[0, cy, cz]}>
        <boxGeometry args={[ww, wh, 0.012]} />
      </mesh>
    </group>
  )
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

  const wallMaterial = useMemo(
    () =>
      node.material
        ? createMaterial(node.material)
        : (createMaterialFromPresetRef(node.materialPreset) ?? defaultWallMaterial),
    [node.material, node.materialPreset],
  )

  const roofMaterial = useMemo(
    () =>
      node.roofMaterial
        ? createMaterial(node.roofMaterial)
        : (createMaterialFromPresetRef(node.roofMaterialPreset) ?? defaultRoofMaterial),
    [node.roofMaterial, node.roofMaterialPreset],
  )

  const frameMaterial = useMemo(
    () =>
      node.frameMaterial
        ? createMaterial(node.frameMaterial)
        : (createMaterialFromPresetRef(node.frameMaterialPreset) ?? defaultFrameMaterial),
    [node.frameMaterial, node.frameMaterialPreset],
  )

  const glassMaterial = useMemo(
    () =>
      node.glassMaterial
        ? createMaterial(node.glassMaterial)
        : (createMaterialFromPresetRef(node.glassMaterialPreset) ?? defaultGlassMaterial.clone()),
    [node.glassMaterial, node.glassMaterialPreset],
  )

  const frontWallGeo = useMemo(() => buildFrontWallGeometry(node), [
    node.width,
    node.depth,
    node.frontWallHeight,
    node.roofPitchDeg,
    node.wallThickness,
    node.hasWindow,
    node.windowWidth,
    node.windowHeight,
    node.windowSillHeight,
  ])

  const leftCheekGeo = useMemo(() => buildCheekWallGeometry(node, 'left'), [
    node.width,
    node.depth,
    node.frontWallHeight,
    node.wallThickness,
  ])
  const rightCheekGeo = useMemo(() => buildCheekWallGeometry(node, 'right'), [
    node.width,
    node.depth,
    node.frontWallHeight,
    node.wallThickness,
  ])

  useEffect(() => {
    return () => {
      frontWallGeo.dispose()
      leftCheekGeo.dispose()
      rightCheekGeo.dispose()
    }
  }, [frontWallGeo, leftCheekGeo, rightCheekGeo])

  if (!segment) return null

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
            geometry={frontWallGeo}
            material={wallMaterial}
            name="dormer-front-wall"
            receiveShadow
          />
          <mesh
            castShadow
            geometry={leftCheekGeo}
            material={wallMaterial}
            name="dormer-cheek-wall"
            receiveShadow
          />
          <mesh
            castShadow
            geometry={rightCheekGeo}
            material={wallMaterial}
            name="dormer-cheek-wall"
            receiveShadow
          />
          <RoofPanel material={roofMaterial} node={node} side="left" />
          <RoofPanel material={roofMaterial} node={node} side="right" />
          {node.hasWindow && (
            <Window frameMaterial={frameMaterial} glassMaterial={glassMaterial} node={node} />
          )}
        </group>
      </group>
    </group>
  )
}

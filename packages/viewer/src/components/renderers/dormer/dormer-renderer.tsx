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
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import { generateDormerGeometry } from '../../../systems/roof/roof-system'

// Dormer-specific material slots. Indices match the segment generator with
// one extra slot for the gable triangle (the wall area above the eave):
//   0 = Rectangular wall (foot → eave)
//   1 = Deck (eave overhang underside)
//   2 = Interior
//   3 = Roof shingle (sloped slabs)
//   4 = Gable triangle wall (eave → ridge)
const dormerMaterials: THREE.Material[] = [
  new THREE.MeshStandardMaterial({ color: 0x4c_a3_5a, roughness: 0.9, side: THREE.DoubleSide }),
  new THREE.MeshStandardMaterial({ color: 0x3a_3a_3a, roughness: 0.85, side: THREE.FrontSide }),
  new THREE.MeshStandardMaterial({ color: 0xd9_d6_cf, roughness: 1, side: THREE.DoubleSide }),
  new THREE.MeshStandardMaterial({ color: 0x4b_3a_30, roughness: 0.85, side: THREE.FrontSide }),
  new THREE.MeshStandardMaterial({ color: 0xc8_3a_3a, roughness: 0.9, side: THREE.DoubleSide }),
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

  const customMaterial = useMemo(() => {
    if (node.material) {
      const m = createMaterial(node.material)
      return [m, m, m, m, m]
    }
    if (node.materialPreset) {
      const m = createMaterialFromPresetRef(node.materialPreset)
      if (m) return [m, m, m, m, m]
    }
    return null
  }, [node.material, node.materialPreset])

  const material = customMaterial ?? dormerMaterials

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
    ],
  )

  useEffect(() => {
    return () => geometry?.dispose()
  }, [geometry])

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
        </group>
      </group>
    </group>
  )
}

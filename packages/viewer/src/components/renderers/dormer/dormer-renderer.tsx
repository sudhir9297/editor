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
import { roofMaterials } from '../roof/roof-materials'

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
      return [m, m, m, m]
    }
    if (node.materialPreset) {
      const m = createMaterialFromPresetRef(node.materialPreset)
      if (m) return [m, m, m, m]
    }
    return null
  }, [node.material, node.materialPreset])

  const material = customMaterial ?? roofMaterials

  const geometry = useMemo(
    () => (segment ? generateDormerGeometry(node, segment) : null),
    [node, segment],
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

import {
  type AnyNodeId,
  type RidgeVentNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import { buildRidgeVentGeometry } from '../../../systems/ridge-vent/ridge-vent-geometry'

const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

export const RidgeVentRenderer = ({ node: storeNode }: { node: RidgeVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'ridge-vent', ref)
  const isTransient = !!(storeNode.metadata as Record<string, unknown> | null)?.isTransient
  const handlers = useNodeEvents(storeNode, 'ridge-vent')

  useFollowSegmentDrag(ref, storeNode.roofSegmentId)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as RidgeVentNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const geometryNode = useMemo(() => {
    if (!liveOverrides) return storeNode
    const rest = { ...(liveOverrides as Record<string, unknown>) }
    delete rest.position
    delete rest.rotation
    return { ...storeNode, ...rest } as RidgeVentNode
  }, [storeNode, liveOverrides])

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(() => {
    if (!segment) return null
    return buildRidgeVentGeometry(geometryNode)
  }, [
    segment,
    node.length,
    node.width,
    node.height,
    node.style,
    node.endCaps,
  ])

  const peakY = segment
    ? segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
    : 0

  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])

  const preset = createMaterialFromPresetRef(node.materialPreset)
  const explicit = node.material ? createMaterial(node.material) : null
  const material = explicit ?? preset ?? defaultMaterial

  if (!segment || !geometry) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <group position={[node.position[0] ?? 0, peakY, node.position[2] ?? 0]} rotation-y={node.rotation ?? 0}>
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          name="ridge-vent-surface"
          receiveShadow
        />
      </group>
    </group>
  )
}

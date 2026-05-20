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

const standardMaterial = new MeshStandardNodeMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

const shingledMaterial = new MeshStandardNodeMaterial({
  color: 0x55_55_55,
  roughness: 0.92,
  metalness: 0.0,
  side: THREE.DoubleSide,
})

const metalMaterial = new MeshStandardNodeMaterial({
  color: 0xa8_a8_a8,
  roughness: 0.35,
  metalness: 0.75,
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

  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])

  const preset = createMaterialFromPresetRef(node.materialPreset)
  const explicit = node.material ? createMaterial(node.material) : null
  const styleFallback = node.style === 'metal' ? metalMaterial
    : node.style === 'shingled' ? shingledMaterial
    : standardMaterial
  const material = explicit ?? preset ?? styleFallback

  if (!segment || !geometry) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <group position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]} rotation-y={node.rotation ?? 0}>
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

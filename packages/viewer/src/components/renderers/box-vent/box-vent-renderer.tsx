import {
  type AnyNodeId,
  type BoxVentNode,
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
import { buildBoxVentGeometry } from '../../../systems/box-vent/box-vent-geometry'

const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

export const BoxVentRenderer = ({ node: storeNode }: { node: BoxVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'box-vent', ref)
  const isTransient = !!(storeNode.metadata as Record<string, unknown> | null)?.isTransient
  const handlers = useNodeEvents(storeNode, 'box-vent')

  useFollowSegmentDrag(ref, storeNode.roofSegmentId)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as BoxVentNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(() => {
    return buildBoxVentGeometry(node)
  }, [node.width, node.depth, node.height, node.hoodOverhang, node.style])

  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])

  const tiltX = useMemo(() => {
    if (!segment) return 0
    if (segment.roofType === 'flat') return 0
    const slopeAngle = Math.atan2(segment.roofHeight, segment.depth / 2)
    const z = node.position[2] ?? 0
    if (z === 0) return 0
    return z > 0 ? slopeAngle : -slopeAngle
  }, [segment?.roofHeight, segment?.depth, segment?.roofType, node.position[2]])

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
      <group position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}>
        <group rotation-x={tiltX}>
          <group rotation-y={node.rotation ?? 0}>
            <mesh
              castShadow
              geometry={geometry}
              material={material}
              name="box-vent-surface"
              receiveShadow
            />
          </group>
        </group>
      </group>
    </group>
  )
}

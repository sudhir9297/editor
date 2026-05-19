import { type DormerNode, useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'

const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xe8_e2_d4,
  roughness: 0.85,
  metalness: 0,
})

const MIN_GEOMETRY_SIZE = 0.01

function positiveSize(value: number) {
  return Number.isFinite(value) ? Math.max(MIN_GEOMETRY_SIZE, value) : MIN_GEOMETRY_SIZE
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
    node.roofSegmentId ? state.nodes[node.roofSegmentId as never] : undefined,
  ) as { position: [number, number, number]; rotation: number } | undefined

  const material = useMemo(
    () =>
      node.material
        ? createMaterial(node.material)
        : (createMaterialFromPresetRef(node.materialPreset) ?? defaultMaterial),
    [node.material, node.materialPreset],
  )

  const geometry = useMemo(() => {
    const w = positiveSize(node.width)
    const h = positiveSize(node.height)
    const d = positiveSize(node.depth)
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(0, h / 2, 0)
    return geo
  }, [node.width, node.height, node.depth])

  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

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

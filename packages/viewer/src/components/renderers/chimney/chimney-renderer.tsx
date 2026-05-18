import {
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'

// Brick-ish default. Will be replaced by a material preset once roof element
// materials are pluggable (pass 2).
const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0x8b_4a_3a,
  roughness: 0.85,
  metalness: 0,
})

export const ChimneyRenderer = ({ node }: { node: ChimneyNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  useRegistry(node.id, 'chimney', ref)
  const handlers = useNodeEvents(node, 'chimney')

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const transform = useMemo(() => {
    if (!segment) return null
    const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
    const topY = peakY + node.heightAboveRidge
    // Anchor the visible mesh to the wall-top / deck-bottom plane. The CSG
    // cut brush extends well below this to carve the slab cleanly, but the
    // visible mesh stops here so the chimney doesn't poke down into the
    // room interior below the ceiling.
    const baseY = segment.wallHeight
    const height = Math.max(0.05, topY - baseY)
    const centerY = (topY + baseY) / 2

    // Chimney's segment-local [u, v]: x and z of node.position. Y is computed.
    const local = new THREE.Vector3(node.position[0], centerY, node.position[2])
    // Apply segment transform (position + rotation around Y) to get roof-local coords.
    const cos = Math.cos(segment.rotation)
    const sin = Math.sin(segment.rotation)
    const x = segment.position[0] + local.x * cos - local.z * sin
    const z = segment.position[2] + local.x * sin + local.z * cos
    const y = segment.position[1] + centerY
    return { x, y, z, height, rotation: segment.rotation + node.rotation }
  }, [
    segment?.position[0],
    segment?.position[1],
    segment?.position[2],
    segment?.rotation,
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    node.position[0],
    node.position[2],
    node.heightAboveRidge,
    node.rotation,
  ])

  const geometry = useMemo(() => {
    const h = transform?.height ?? 1
    return new THREE.BoxGeometry(node.width, h, node.depth)
  }, [node.width, node.depth, transform?.height])

  if (!transform) return null

  return (
    <mesh
      castShadow
      geometry={geometry}
      material={defaultMaterial}
      position={[transform.x, transform.y, transform.z]}
      receiveShadow
      ref={ref}
      rotation-y={transform.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}

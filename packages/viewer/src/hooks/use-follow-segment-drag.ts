import { type AnyNodeId, sceneRegistry, useLiveTransforms } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type * as THREE from 'three'

// Roof children (chimney, skylight, solar panel) render as siblings of the
// roof segment mesh, both rooted in the same roof-local frame. Their outer
// group's position is taken from `segment.position` in the store, but the
// move-roof tool mutates the segment mesh directly without touching the store
// during drag. This hook closes the gap: while a live transform exists for
// the parent segment, copy the segment mesh's parent-local pose onto the
// child renderer's outer group each frame. On commit the store updates and
// React's normal render flow restores everything.
export function useFollowSegmentDrag(
  groupRef: RefObject<THREE.Group | null>,
  roofSegmentId: string | undefined,
) {
  useFrame(() => {
    const group = groupRef.current
    if (!(group && roofSegmentId)) return
    if (!useLiveTransforms.getState().transforms.has(roofSegmentId)) return
    const segMesh = sceneRegistry.nodes.get(roofSegmentId as AnyNodeId)
    if (!segMesh) return
    group.position.copy(segMesh.position)
    group.rotation.y = segMesh.rotation.y
  })
}

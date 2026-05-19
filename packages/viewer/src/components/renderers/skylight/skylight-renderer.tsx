import {
  type AnyNodeId,
  type RoofSegmentNode,
  type SkylightNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Brush, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import { csgEvaluator, csgGeometry, getRoofOuterSurfaceFrameAtPoint } from '../../../systems/roof/roof-system'

const defaultFrameMaterial = new MeshStandardNodeMaterial({
  color: 0x555555,
  roughness: 0.3,
  metalness: 0.5,
})

const defaultGlassMaterial = new MeshPhysicalNodeMaterial({
  color: 0x88ccee,
  roughness: 0.05,
  metalness: 0,
  transparent: true,
  opacity: 0.4,
  transmission: 0.8,
  ior: 1.5,
  thickness: 0.01,
})

const visibleDummyMat = new THREE.MeshBasicMaterial()

/**
 * Build a frame ring geometry centered at origin with Y as the depth axis
 * (perpendicular to the glass plane). The geometry is NOT positioned or rotated —
 * the React component handles that via group transforms so frame and glass
 * share the same coordinate system and can never misalign.
 *
 * Y=0 is the roof surface contact point. Frame extends downward (-Y) into the
 * roof deck by frameDepth, and upward (+Y) by curbHeight.
 */
function buildFrameGeometry(node: SkylightNode): THREE.BufferGeometry | null {
  const w = node.width
  const h = node.height
  const ft = node.frameThickness
  const fd = node.frameDepth
  const hasCurb = node.curb ?? false
  const curbH = hasCurb ? Math.max(0, node.curbHeight ?? 0.1) : 0

  const outerW = w + 2 * ft
  const outerH = h + 2 * ft
  const totalDepth = fd + curbH

  const outerBox = new THREE.BoxGeometry(outerW, totalDepth, outerH)
  const innerBox = new THREE.BoxGeometry(w, totalDepth + 0.02, h)

  const setupGeo = (geo: THREE.BufferGeometry) => {
    const ic = geo.getIndex()?.count ?? 0
    geo.clearGroups()
    if (ic > 0) geo.addGroup(0, ic, 0)
    ;(geo as any).computeBoundsTree = computeBoundsTree
    ;(geo as any).computeBoundsTree({ maxLeafSize: 10 })
  }
  setupGeo(outerBox)
  setupGeo(innerBox)

  let frameGeo: THREE.BufferGeometry
  try {
    const outerBrush = new Brush(outerBox, visibleDummyMat as any)
    outerBrush.updateMatrixWorld()
    const innerBrush = new Brush(innerBox, visibleDummyMat as any)
    innerBrush.updateMatrixWorld()
    const result = csgEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION) as Brush
    frameGeo = csgGeometry(result).clone()
    const ic = frameGeo.getIndex()?.count ?? 0
    frameGeo.clearGroups()
    if (ic > 0) frameGeo.addGroup(0, ic, 0)
    outerBox.dispose()
    innerBox.dispose()
    result.geometry.dispose()
  } catch (e) {
    console.error('Skylight frame CSG failed:', e)
    outerBox.dispose()
    innerBox.dispose()
    return null
  }

  // Shift so Y=0 is the roof surface contact: frame extends down by fd, up by curbH
  frameGeo.translate(0, -totalDepth / 2 + curbH, 0)

  return frameGeo
}

export const SkylightRenderer = ({ node: storeNode }: { node: SkylightNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'skylight', ref)
  const handlers = useNodeEvents(storeNode, 'skylight')

  useFollowSegmentDrag(ref, storeNode.roofSegmentId)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as SkylightNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const frameGeo = useMemo(() => {
    return buildFrameGeometry(node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    node.width,
    node.height,
    node.frameThickness,
    node.frameDepth,
    node.skylightType,
    node.curb,
    node.curbHeight,
  ])

  useEffect(() => {
    return () => {
      frameGeo?.dispose()
    }
  }, [frameGeo])

  const framePreset = createMaterialFromPresetRef(node.materialPreset)
  const frameExplicit = node.material ? createMaterial(node.material) : null
  const frameMaterial = frameExplicit ?? framePreset ?? defaultFrameMaterial

  const glassPreset = createMaterialFromPresetRef(node.glassMaterialPreset)
  const glassExplicit = node.glassMaterial ? createMaterial(node.glassMaterial) : null
  const glassMaterial = glassExplicit ?? glassPreset ?? defaultGlassMaterial

  const surfaceFrame = useMemo(() => {
    if (!segment) {
      return { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }
    }
    return getRoofOuterSurfaceFrameAtPoint(segment, node.position[0], node.position[2])
  }, [node.position[0], node.position[2], segment])

  const surfaceY = surfaceFrame.point.y

  const slopeQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceFrame.normal)
  }, [segment, node.position[0], node.position[2]])

  const hasCurb = node.curb ?? false
  const curbH = hasCurb ? Math.max(0, node.curbHeight ?? 0.1) : 0

  if (!segment || !frameGeo) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      {/* Single transform hierarchy: position on surface → tilt to slope → yaw */}
      <group position={[node.position[0], surfaceY, node.position[2]]}>
        <group quaternion={slopeQuat}>
          <group rotation-y={node.rotation}>
            <mesh
              castShadow
              geometry={frameGeo}
              material={frameMaterial}
              name="skylight-surface"
              receiveShadow
            />
            <mesh
              material={glassMaterial}
              name="skylight-glass"
              position={[0, curbH, 0]}
              receiveShadow
              rotation-x={-Math.PI / 2}
            >
              <planeGeometry args={[node.width - 0.01, node.height - 0.01]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

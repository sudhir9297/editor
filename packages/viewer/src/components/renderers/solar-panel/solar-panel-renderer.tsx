import {
  type AnyNodeId,
  type RoofSegmentNode,
  type SolarPanelNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useFollowSegmentDrag } from '../../../hooks/use-follow-segment-drag'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterialFromPresetRef } from '../../../lib/materials'
import {
  buildSolarPanelGeometry,
  getAnalyticalNormal,
  getDefaultPanelMaterial,
  getSurfaceY,
  surfaceQuatFromWorldNormal,
} from '../../../systems/solar-panel/solar-panel-geometry'

const defaultFrameMaterial = new MeshStandardNodeMaterial({
  color: new THREE.Color(0.6, 0.6, 0.65),
  roughness: 0.4,
  metalness: 0.8,
})

export function SolarPanelRenderer({ node }: { node: SolarPanelNode }) {
  const groupRef = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'solar-panel', groupRef)
  const handlers = useNodeEvents(node, 'solar-panel')

  const overrides = useLiveNodeOverrides((s) =>
    s.get(node.id as AnyNodeId) as Partial<SolarPanelNode> | undefined,
  )
  const effective = overrides ? { ...node, ...overrides } : node

  const segment = useScene((s) =>
    effective.roofSegmentId
      ? (s.nodes[effective.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(
    () => buildSolarPanelGeometry(effective),
    [
      effective.rows,
      effective.columns,
      effective.panelWidth,
      effective.panelHeight,
      effective.gapX,
      effective.gapY,
      effective.frameThickness,
      effective.frameDepth,
      effective.standoffHeight,
    ],
  )

  const materials = useMemo(() => {
    const frame = effective.materialPreset
      ? (createMaterialFromPresetRef(effective.materialPreset) ?? defaultFrameMaterial)
      : defaultFrameMaterial
    const panel = effective.panelMaterialPreset
      ? (createMaterialFromPresetRef(effective.panelMaterialPreset) ?? getDefaultPanelMaterial())
      : getDefaultPanelMaterial()
    return [frame, panel] as THREE.Material[]
  }, [effective.materialPreset, effective.panelMaterialPreset])

  const surfaceGroupRef = useRef<THREE.Group>(null!)
  const lastAppliedQuat = useRef(new THREE.Quaternion())

  useFollowSegmentDrag(groupRef, effective.roofSegmentId)

  useFrame(() => {
    const surfaceGroup = surfaceGroupRef.current
    if (!(surfaceGroup && segment)) return

    const parent = surfaceGroup.parent

    let worldNormal: THREE.Vector3
    if (effective.surfaceNormal) {
      worldNormal = new THREE.Vector3(
        effective.surfaceNormal[0],
        effective.surfaceNormal[1],
        effective.surfaceNormal[2],
      ).normalize()
    } else {
      const localN = getAnalyticalNormal(
        effective.position[0],
        effective.position[2],
        segment,
      ).clone()
      if (parent) {
        const parentQuatFallback = new THREE.Quaternion()
        parent.getWorldQuaternion(parentQuatFallback)
        worldNormal = localN.applyQuaternion(parentQuatFallback).normalize()
      } else {
        worldNormal = localN.normalize()
      }
    }

    const desiredWorldQuat = surfaceQuatFromWorldNormal(worldNormal, new THREE.Quaternion())

    let target: THREE.Quaternion
    if (parent) {
      const parentQuat = new THREE.Quaternion()
      parent.getWorldQuaternion(parentQuat)
      target = parentQuat.invert().multiply(desiredWorldQuat)
    } else {
      target = desiredWorldQuat
    }

    if (!lastAppliedQuat.current.equals(target)) {
      surfaceGroup.quaternion.copy(target)
      lastAppliedQuat.current.copy(target)
    }
  })

  if (!geometry || !segment) return null

  const surfaceY =
    effective.position[1] !== 0
      ? effective.position[1]
      : getSurfaceY(effective.position[0], effective.position[2], segment)

  const tiltRad =
    effective.mountingType === 'tilted' ? (effective.tiltAngle * Math.PI) / 180 : 0

  return (
    <group
      position={segment.position}
      ref={groupRef}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      <group position={[effective.position[0], surfaceY, effective.position[2]]}>
        <group ref={surfaceGroupRef}>
          <group rotation-y={effective.rotation}>
            <group rotation-x={tiltRad}>
              <mesh
                castShadow
                geometry={geometry}
                material={materials}
                receiveShadow
              />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

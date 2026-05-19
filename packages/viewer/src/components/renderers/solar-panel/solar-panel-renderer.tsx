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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterialFromPresetRef } from '../../../lib/materials'

const defaultFrameMaterial = new MeshStandardNodeMaterial({
  color: new THREE.Color(0.6, 0.6, 0.65),
  roughness: 0.4,
  metalness: 0.8,
})

const defaultPanelMaterial = new MeshStandardNodeMaterial({
  color: new THREE.Color(0.05, 0.05, 0.12),
  roughness: 0.15,
  metalness: 0.3,
})

const _up = new THREE.Vector3(0, 1, 0)
const _normal = new THREE.Vector3()

// Build a "natural" world rotation that aligns the panel's local +Y with
// the surface normal, AND aligns the panel's local +X with the horizontal
// direction perpendicular to the slope (i.e. along the roof's ridge / edge).
// This gives a deterministic, intuitive orientation regardless of slope
// direction — better than `setFromUnitVectors` which picks an arbitrary
// shortest-arc rotation that can leave the panel's columns at an odd yaw.
export function surfaceQuatFromWorldNormal(worldNormal: THREE.Vector3, out: THREE.Quaternion) {
  const right = new THREE.Vector3().crossVectors(_up, worldNormal)
  if (right.lengthSq() < 1e-6) {
    // worldNormal is (anti-)parallel to world UP — flat roof, no preferred
    // yaw direction. Use world X as the panel's right.
    right.set(1, 0, 0)
  } else {
    right.normalize()
  }
  // Right-handed basis: forward = right × up so that (right, up, forward)
  // has determinant +1. Using `up × right` would build a reflection matrix
  // (det = -1), and `setFromRotationMatrix` on a reflection produces a
  // quaternion that doesn't represent a pure rotation — visible as a wrong
  // panel orientation on every non-flat slope.
  const forward = new THREE.Vector3().crossVectors(right, worldNormal).normalize()
  const m = new THREE.Matrix4().makeBasis(right, worldNormal, forward)
  return out.setFromRotationMatrix(m)
}

function getSurfaceY(lx: number, lz: number, seg: RoofSegmentNode): number {
  const { roofType, wallHeight, roofHeight, depth, width } = seg
  const rh = roofType === 'flat' ? 0 : roofHeight
  const peakY = wallHeight + rh
  if (rh === 0) return wallHeight

  if (roofType === 'gable') {
    const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - t * rh
  }
  if (roofType === 'shed') {
    const t = (lz + depth / 2) / (depth || 1)
    return peakY - t * rh
  }
  if (roofType === 'hip') {
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - Math.max(fx, fz) * rh
  }
  const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
  return peakY - t * rh
}

function getAnalyticalNormal(lx: number, lz: number, seg: RoofSegmentNode): THREE.Vector3 {
  const { roofType, roofHeight, depth, width } = seg
  const rh = roofType === 'flat' ? 0 : roofHeight
  if (rh === 0) return _normal.set(0, 1, 0)

  if (roofType === 'gable') {
    const halfD = depth / 2
    return _normal.set(0, halfD, lz >= 0 ? rh : -rh).normalize()
  }
  if (roofType === 'shed') {
    return _normal.set(0, depth, -rh).normalize()
  }
  if (roofType === 'hip') {
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    if (fz >= fx) {
      return _normal.set(0, depth / 2, lz >= 0 ? rh : -rh).normalize()
    }
    return _normal.set(lx >= 0 ? rh : -rh, width / 2, 0).normalize()
  }
  const halfD = depth / 2
  return _normal.set(0, halfD, lz >= 0 ? rh : -rh).normalize()
}

function buildSolarPanelGeometry(node: SolarPanelNode): THREE.BufferGeometry | null {
  const {
    rows,
    columns,
    panelWidth,
    panelHeight,
    gapX,
    gapY,
    frameThickness,
    frameDepth,
    standoffHeight,
  } = node

  const frameGeos: THREE.BufferGeometry[] = []
  const panelGeos: THREE.BufferGeometry[] = []

  const totalW = columns * panelWidth + (columns - 1) * gapX
  const totalH = rows * panelHeight + (rows - 1) * gapY
  const originX = -totalW / 2
  const originZ = -totalH / 2

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cx = originX + c * (panelWidth + gapX) + panelWidth / 2
      const cz = originZ + r * (panelHeight + gapY) + panelHeight / 2
      const y = standoffHeight + frameDepth / 2

      const glassW = panelWidth - 2 * frameThickness
      const glassH = panelHeight - 2 * frameThickness
      if (glassW > 0 && glassH > 0) {
        const glass = new THREE.BoxGeometry(glassW, frameDepth * 0.6, glassH)
        glass.translate(cx, y + frameDepth * 0.2, cz)
        panelGeos.push(glass)
      }

      const ft = frameThickness
      const fd = frameDepth

      const left = new THREE.BoxGeometry(ft, fd, panelHeight)
      left.translate(cx - panelWidth / 2 + ft / 2, y, cz)
      frameGeos.push(left)

      const right = new THREE.BoxGeometry(ft, fd, panelHeight)
      right.translate(cx + panelWidth / 2 - ft / 2, y, cz)
      frameGeos.push(right)

      const top = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      top.translate(cx, y, cz - panelHeight / 2 + ft / 2)
      frameGeos.push(top)

      const bottom = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      bottom.translate(cx, y, cz + panelHeight / 2 - ft / 2)
      frameGeos.push(bottom)
    }
  }

  if (frameGeos.length === 0) return null

  const frameMerged = mergeGeometries(frameGeos, false)
  const panelMerged = panelGeos.length > 0 ? mergeGeometries(panelGeos, false) : null

  for (const g of frameGeos) g.dispose()
  for (const g of panelGeos) g.dispose()

  if (!frameMerged) return null

  if (panelMerged) {
    const combined = mergeGeometries([frameMerged, panelMerged], true)
    frameMerged.dispose()
    panelMerged.dispose()
    return combined
  }

  frameMerged.clearGroups()
  frameMerged.addGroup(0, frameMerged.index?.count ?? frameMerged.attributes.position!.count, 0)
  return frameMerged
}

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
      ? (createMaterialFromPresetRef(effective.panelMaterialPreset) ?? defaultPanelMaterial)
      : defaultPanelMaterial
    return [frame, panel] as THREE.Material[]
  }, [effective.materialPreset, effective.panelMaterialPreset])

  const surfaceGroupRef = useRef<THREE.Group>(null!)
  const lastAppliedQuat = useRef(new THREE.Quaternion())

  // Orient the surface group so its world +Y aligns with the roof surface
  // normal. Runs each frame after R3F has updated all ancestor world matrices,
  // so the parent's world quaternion we read is guaranteed fresh — no need
  // to manually updateWorldMatrix(). We compute the desired WORLD quaternion
  // (matching what the ghost preview shows) and convert it into the panel's
  // actual parent-local frame. This avoids the "shortest-arc" axis ambiguity
  // that arises if we apply setFromUnitVectors directly in the local frame.
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
      // Analytical fallback for panels created without a captured normal.
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

    // Desired world orientation: panel +Y aligned with surface normal AND
    // panel +X aligned with the horizontal direction perpendicular to the
    // slope (along the roof ridge). Matches the ghost preview.
    const desiredWorldQuat = surfaceQuatFromWorldNormal(worldNormal, new THREE.Quaternion())

    let target: THREE.Quaternion
    if (parent) {
      const parentQuat = new THREE.Quaternion()
      parent.getWorldQuaternion(parentQuat)
      target = parentQuat.invert().multiply(desiredWorldQuat)
    } else {
      target = desiredWorldQuat
    }

    // Skip the assignment if the quaternion hasn't changed — avoids dirtying
    // the matrix every frame for a static panel.
    if (!lastAppliedQuat.current.equals(target)) {
      surfaceGroup.quaternion.copy(target)
      lastAppliedQuat.current.copy(target)
    }
  })

  if (!geometry || !segment) return null

  // Prefer the captured hit Y (segment-local) — it lands on the actual
  // shingle surface. Fall back to the analytical bare-rafter height for
  // legacy panels created before we stored y.
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

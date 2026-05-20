import {
  type AnyNodeId,
  type ChimneyNode,
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
import {
  buildCapGeometry,
  buildChimneyGeometry,
  buildFluesGeometry,
} from '../../../systems/chimney/chimney-geometry'

const defaultMaterial = new MeshStandardNodeMaterial({
  roughness: 0.85,
  metalness: 0,
})

export const ChimneyRenderer = ({ node: storeNode }: { node: ChimneyNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'chimney', ref)
  const isTransient = !!(storeNode.metadata as Record<string, unknown> | null)?.isTransient
  const handlers = useNodeEvents(storeNode, 'chimney')

  useFollowSegmentDrag(ref, storeNode.roofSegmentId)

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as ChimneyNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const geometryNode = useMemo(() => {
    if (!liveOverrides) return storeNode
    const rest = { ...(liveOverrides as Record<string, unknown>) }
    delete rest.position
    delete rest.rotation
    return { ...storeNode, ...rest } as ChimneyNode
  }, [storeNode, liveOverrides])

  const liveDeltaX = (node.position[0] ?? 0) - (storeNode.position[0] ?? 0)
  const liveDeltaZ = (node.position[2] ?? 0) - (storeNode.position[2] ?? 0)
  const liveDeltaRot = (node.rotation ?? 0) - (storeNode.rotation ?? 0)

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(() => {
    if (!segment) return null
    return buildChimneyGeometry(geometryNode, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.position[0],
    segment?.position[1],
    segment?.position[2],
    segment?.rotation,
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    segment?.width,
    segment?.depth,
    segment?.wallThickness,
    segment?.deckThickness,
    segment?.overhang,
    segment?.shingleThickness,
    geometryNode.position[0],
    geometryNode.position[2],
    geometryNode.rotation,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.shoulderStyle,
    node.shoulderHeight,
    node.shoulderExtent,
    node.bandStyle,
    node.bandHeight,
    node.bandExtent,
    node.bandOffset,
    node.cricketStyle,
    node.cricketLength,
    node.cricketHeight,
    node.cricketSide,
    node.bodyShape,
    node.bodyHollowDepth,
    node.bodyHollowMargin,
    node.panelStyle,
    node.panelDepth,
    node.panelHeight,
    node.panelOffsetTop,
    node.panelMargin,
    node.flueCount,
    node.flueDiameter,
    node.flueWallThickness,
    node.flueSpacing,
    node.flueShape,
  ])

  const capGeometry = useMemo(() => {
    if (!segment) return null
    if (!(node.cap ?? true)) return null
    if ((node.capShape ?? 'sloped') === 'none') return null
    return buildCapGeometry(geometryNode, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    geometryNode.position[0],
    geometryNode.position[2],
    geometryNode.rotation,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.cap,
    node.capShape,
    node.capOverhang,
    node.capThickness,
    node.bodyShape,
    node.bodyHollowMargin,
    node.flueCount,
    node.flueDiameter,
    node.flueWallThickness,
    node.flueSpacing,
    node.flueShape,
  ])

  useEffect(() => {
    return () => {
      geometry?.body.dispose()
      geometry?.bands?.dispose()
    }
  }, [geometry])

  useEffect(() => {
    return () => {
      capGeometry?.dispose()
    }
  }, [capGeometry])

  const fluesGeometry = useMemo(() => {
    if (!segment) return null
    return buildFluesGeometry(geometryNode, segment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    geometryNode.position[0],
    geometryNode.position[2],
    geometryNode.rotation,
    node.width,
    node.heightAboveRidge,
    node.cap,
    node.capThickness,
    node.flueCount,
    node.flueShape,
    node.flueHeight,
    node.flueDiameter,
    node.flueSpacing,
    node.flueWallThickness,
  ])

  useEffect(() => {
    return () => {
      fluesGeometry?.dispose()
    }
  }, [fluesGeometry])

  const bodyPreset = createMaterialFromPresetRef(node.materialPreset)
  const bodyExplicit = node.material ? createMaterial(node.material) : null
  const material = bodyExplicit ?? bodyPreset ?? defaultMaterial

  const topPreset = createMaterialFromPresetRef(node.topMaterialPreset)
  const topExplicit = node.topMaterial ? createMaterial(node.topMaterial) : null
  const topMaterial = topExplicit ?? topPreset ?? material

  const surfaceArray = [material, topMaterial]

  if (!segment || !geometry) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <group position={[liveDeltaX, 0, liveDeltaZ]} rotation-y={liveDeltaRot}>
        <mesh
          castShadow
          geometry={geometry.body}
          material={surfaceArray}
          name="chimney-surface"
          receiveShadow
        />
        {geometry.bands && (
          <mesh
            castShadow
            geometry={geometry.bands}
            material={material}
            name="chimney-surface"
            receiveShadow
          />
        )}
        {capGeometry && (
          <mesh
            castShadow
            geometry={capGeometry}
            material={surfaceArray}
            name="chimney-surface"
            receiveShadow
          />
        )}
        {fluesGeometry && (
          <mesh
            castShadow
            geometry={fluesGeometry}
            material={surfaceArray}
            name="chimney-surface"
            receiveShadow
          />
        )}
      </group>
    </group>
  )
}

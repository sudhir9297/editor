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
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import {
  csgEvaluator,
  csgGeometry,
  getRoofSegmentBrushes,
  prepareBrushForCSG,
} from '../../../systems/roof/roof-system'

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

function buildSkylightGeometry(
  node: SkylightNode,
  segment: RoofSegmentNode,
): { frame: THREE.BufferGeometry; glass: THREE.BufferGeometry } | null {
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

  frameGeo.translate(0, curbH / 2, 0)

  const segBrushes = getRoofSegmentBrushes(segment)
  if (segBrushes) {
    const { wallBrush, shinTopBrush } = segBrushes
    try {
      frameGeo.computeVertexNormals()
      const pc = frameGeo.getAttribute('position').count
      frameGeo.clearGroups()
      frameGeo.addGroup(0, frameGeo.getIndex()?.count ?? pc, 0)
      ;(frameGeo as any).computeBoundsTree = computeBoundsTree
      ;(frameGeo as any).computeBoundsTree({ maxLeafSize: 10 })

      const frameBrush = new Brush(frameGeo, visibleDummyMat as any)
      frameBrush.updateMatrixWorld()

      const step1 = csgEvaluator.evaluate(frameBrush, wallBrush, SUBTRACTION) as Brush
      prepareBrushForCSG(step1)
      const trimmed = csgEvaluator.evaluate(step1, shinTopBrush, SUBTRACTION) as Brush
      const trimmedGeo = csgGeometry(trimmed).clone()
      const tic = trimmedGeo.getIndex()?.count ?? 0
      trimmedGeo.clearGroups()
      if (tic > 0) trimmedGeo.addGroup(0, tic, 0)
      trimmedGeo.computeVertexNormals()

      frameGeo.dispose()
      step1.geometry.dispose()
      trimmed.geometry.dispose()
      frameGeo = trimmedGeo
    } catch (e) {
      console.error('Skylight frame trim CSG failed:', e)
    } finally {
      segBrushes.deckSlab.geometry.dispose()
      segBrushes.shinSlab.geometry.dispose()
      segBrushes.wallBrush.geometry.dispose()
      segBrushes.innerBrush.geometry.dispose()
      segBrushes.shinTopBrush.geometry.dispose()
    }
  }

  if (Math.abs(node.rotation) > 1e-4) frameGeo.rotateY(node.rotation)
  frameGeo.translate(node.position[0], 0, node.position[2])

  const glassGeo = new THREE.PlaneGeometry(w - 0.01, h - 0.01)
  glassGeo.rotateX(-Math.PI / 2)
  glassGeo.translate(0, curbH + fd / 2, 0)
  if (Math.abs(node.rotation) > 1e-4) glassGeo.rotateY(node.rotation)
  glassGeo.translate(node.position[0], 0, node.position[2])

  return { frame: frameGeo, glass: glassGeo }
}

export const SkylightRenderer = ({ node: storeNode }: { node: SkylightNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'skylight', ref)
  const handlers = useNodeEvents(storeNode, 'skylight')

  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as SkylightNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const geometryNode = useMemo(() => {
    if (!liveOverrides) return storeNode
    const rest = { ...(liveOverrides as Record<string, unknown>) }
    delete rest.position
    delete rest.rotation
    return { ...storeNode, ...rest } as SkylightNode
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
    return buildSkylightGeometry(geometryNode, segment)
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
    node.height,
    node.frameThickness,
    node.frameDepth,
    node.skylightType,
    node.curb,
    node.curbHeight,
  ])

  useEffect(() => {
    return () => {
      geometry?.frame.dispose()
      geometry?.glass.dispose()
    }
  }, [geometry])

  const framePreset = createMaterialFromPresetRef(node.materialPreset)
  const frameExplicit = node.material ? createMaterial(node.material) : null
  const frameMaterial = frameExplicit ?? framePreset ?? defaultFrameMaterial

  const glassPreset = createMaterialFromPresetRef(node.glassMaterialPreset)
  const glassExplicit = node.glassMaterial ? createMaterial(node.glassMaterial) : null
  const glassMaterial = glassExplicit ?? glassPreset ?? defaultGlassMaterial

  if (!segment || !geometry) return null

  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      <group position={[liveDeltaX, 0, liveDeltaZ]} rotation-y={liveDeltaRot}>
        <mesh
          castShadow
          geometry={geometry.frame}
          material={frameMaterial}
          name="skylight-surface"
          receiveShadow
        />
        <mesh
          geometry={geometry.glass}
          material={glassMaterial}
          name="skylight-glass"
          receiveShadow
        />
      </group>
    </group>
  )
}

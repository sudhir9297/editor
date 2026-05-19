import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  type ChimneyNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'

function resolveSegmentFromWorldPoint(
  roof: RoofNode,
  worldX: number,
  worldY: number,
  worldZ: number,
  state: ReturnType<typeof useScene.getState>,
): { segment: RoofSegmentNode; localX: number; localZ: number } | null {
  const worldPt = new THREE.Vector3(worldX, worldY, worldZ)
  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(worldPt.clone())
    if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
      return { segment: seg, localX: local.x, localZ: local.z }
    }
  }
  return null
}

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x88_88_88,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
})

export function MoveChimneyTool({ node }: { node: ChimneyNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])

  // Build a simple untrimmed box matching the chimney dimensions.
  const segment = useScene((s) =>
    node.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  const previewGeo = useMemo(() => {
    if (!segment) return null
    const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
    const topY = peakY + (node.heightAboveRidge ?? 1)
    const baseY = segment.wallHeight
    const h = Math.max(0.05, topY - baseY)
    const geo = new THREE.BoxGeometry(node.width, h, node.depth)
    // Position so the bottom sits at y=0 (the hit point on the roof surface).
    geo.translate(0, h / 2, 0)
    return geo
  }, [segment, node.width, node.depth, node.heightAboveRidge])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      heightAboveRidge: node.heightAboveRidge ?? 1,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      visible: node.visible,
      metadata: node.metadata,
    }

    let wasCommitted = false
    let wasCancelled = false

    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    // Hide the real chimney mesh — we show the preview box instead.
    const chimneyObj = sceneRegistry.nodes.get(node.id)
    if (chimneyObj) chimneyObj.visible = false

    // Convert world position to building-local (the ToolManager group is
    // building-local, so the preview must be positioned in that space).
    const worldToBuildingLocal = (wx: number, wy: number, wz: number): [number, number, number] => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (buildingObj) {
        const v = new THREE.Vector3(wx, wy, wz)
        buildingObj.worldToLocal(v)
        return [v.x, v.y, v.z]
      }
      return [wx, wy, wz]
    }

    let lastSnapX = 0
    let lastSnapZ = 0

    const onRoofMove = (event: RoofEvent) => {
      const wx = event.position[0]
      const wy = event.position[1]
      const wz = event.position[2]

      // Play snap sound when position changes.
      const sx = Math.round(wx * 20) / 20
      const sz = Math.round(wz * 20) / 20
      if (sx !== lastSnapX || sz !== lastSnapZ) {
        sfxEmitter.emit('sfx:grid-snap')
        lastSnapX = sx
        lastSnapZ = sz
      }

      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const st = useScene.getState()

      const hit = resolveSegmentFromWorldPoint(
        roof,
        event.position[0],
        event.position[1],
        event.position[2],
        st,
      )
      if (!hit) return

      const targetSegmentId = hit.segment.id as AnyNodeId

      // Compute rotation and height adjustments for cross-segment placement.
      let finalRotation = original.rotation
      let finalHeightAboveRidge = original.heightAboveRidge
      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        const prevSeg = st.nodes[original.roofSegmentId as AnyNodeId] as
          | RoofSegmentNode
          | undefined
        if (prevSeg) {
          const prevPeakY =
            prevSeg.wallHeight + (prevSeg.roofType === 'flat' ? 0 : prevSeg.roofHeight)
          const nextPeakY =
            hit.segment.wallHeight +
            (hit.segment.roofType === 'flat' ? 0 : hit.segment.roofHeight)
          const prevRoof = prevSeg.parentId
            ? (st.nodes[prevSeg.parentId as AnyNodeId] as AnyNode | undefined)
            : undefined
          const prevRoofPos = prevRoof && 'position' in prevRoof
            ? (prevRoof as { position: [number, number, number] })
            : undefined
          const roofPos = roof as unknown as { position?: [number, number, number] }
          const oldTopWorldY =
            (prevRoofPos?.position?.[1] ?? 0) +
            (prevSeg.position[1] ?? 0) +
            prevPeakY +
            original.heightAboveRidge
          finalHeightAboveRidge = Math.max(
            0.1,
            oldTopWorldY -
              (roofPos.position?.[1] ?? 0) -
              (hit.segment.position[1] ?? 0) -
              nextPeakY,
          )
          finalRotation =
            prevSeg.rotation + original.rotation - hit.segment.rotation
        }
      }

      wasCommitted = true

      // Restore original state for clean undo baseline.
      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        heightAboveRidge: original.heightAboveRidge,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      useScene.temporal.getState().resume()

      st.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [hit.localX, 0, hit.localZ],
        rotation: finalRotation,
        heightAboveRidge: finalHeightAboveRidge,
        visible: true,
        metadata: {},
      })

      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        st.dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }
      st.dirtyNodes.add(targetSegmentId)
      st.dirtyNodes.add(node.id as AnyNodeId)

      useScene.temporal.getState().pause()

      // Show the real chimney again.
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
      wasCancelled = true

      if (isNew) {
        useScene.temporal.getState().resume()
        useScene.getState().deleteNode(node.id as AnyNodeId)
        markToolCancelConsumed()
        exitMoveMode()
        return
      }

      useScene.getState().updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        heightAboveRidge: original.heightAboveRidge,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      if (original.roofSegmentId) {
        useScene.getState().dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('roof:move', onRoofMove)
    emitter.on('roof:enter', onRoofEnter)
    emitter.on('roof:click', onRoofClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('roof:move', onRoofMove)
      emitter.off('roof:enter', onRoofEnter)
      emitter.off('roof:click', onRoofClick)
      emitter.off('tool:cancel', onCancel)

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  if (!previewGeo) return null

  return (
    <group position={previewPos} ref={previewRef} rotation-y={node.rotation ?? 0}>
      <mesh
        geometry={previewGeo}
        layers={EDITOR_LAYER}
        material={previewMaterial}
      />
    </group>
  )
}

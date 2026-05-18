import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  type SkylightNode,
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

export function MoveSkylightTool({ node }: { node: SkylightNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])

  const previewGeo = useMemo(() => {
    const outerW = node.width + 2 * node.frameThickness
    const outerH = node.height + 2 * node.frameThickness
    const geo = new THREE.BoxGeometry(outerW, node.frameDepth, outerH)
    geo.translate(0, node.frameDepth / 2, 0)
    return geo
  }, [node.width, node.height, node.frameThickness, node.frameDepth])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }

    let wasCommitted = false
    let wasCancelled = false

    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const skylightObj = sceneRegistry.nodes.get(node.id)
    if (skylightObj) skylightObj.visible = false

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

      let finalRotation = original.rotation
      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        const prevSeg = st.nodes[original.roofSegmentId as AnyNodeId] as
          | RoofSegmentNode
          | undefined
        if (prevSeg) {
          finalRotation = prevSeg.rotation + original.rotation - hit.segment.rotation
        }
      }

      wasCommitted = true

      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
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
        metadata: {},
      })

      if (original.roofSegmentId && original.roofSegmentId !== (targetSegmentId as string)) {
        st.dirtyNodes.add(original.roofSegmentId as AnyNodeId)
      }
      st.dirtyNodes.add(targetSegmentId)
      st.dirtyNodes.add(node.id as AnyNodeId)

      useScene.temporal.getState().pause()

      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true

      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.stopPropagation()
    }

    const onCancel = () => {
      wasCancelled = true
      useScene.getState().updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
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

      const current = useScene.getState().nodes[node.id as AnyNodeId] as SkylightNode | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (!(wasCommitted || wasCancelled) && currentMeta?.isTransient) {
        useScene.getState().updateNode(node.id as AnyNodeId, {
          position: original.position,
          rotation: original.rotation,
          roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
          parentId: original.parentId as AnyNodeId | undefined,
          metadata: original.metadata,
        })
        if (original.roofSegmentId) {
          useScene.getState().dirtyNodes.add(original.roofSegmentId as AnyNodeId)
        }
      }
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

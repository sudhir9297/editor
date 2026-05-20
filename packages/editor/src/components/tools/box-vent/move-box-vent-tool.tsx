import '../../../three-types'

import {
  type AnyNodeId,
  type BoxVentNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { buildBoxVentGeometry, useViewer } from '@pascal-app/viewer'
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
): { segment: RoofSegmentNode; localX: number; localY: number; localZ: number } | null {
  const worldPt = new THREE.Vector3(worldX, worldY, worldZ)
  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(worldPt.clone())
    if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
      return { segment: seg, localX: local.x, localY: local.y, localZ: local.z }
    }
  }
  return null
}

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  emissive: 0xff_ff_ff,
  emissiveIntensity: 0.12,
  roughness: 0.85,
  metalness: 0.05,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const previewEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0x6c_a3_ff,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
})

const previewFootprintMaterial = new THREE.LineBasicMaterial({
  color: 0x6c_a3_ff,
  transparent: true,
  opacity: 0.7,
  depthTest: false,
})

export function MoveBoxVentTool({ node }: { node: BoxVentNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  const [previewTilt, setPreviewTilt] = useState(0)
  const [previewSegYaw, setPreviewSegYaw] = useState(0)

  const segment = useScene((s) =>
    node.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const previewGeo = useMemo(() => buildBoxVentGeometry(node), [
    node.width,
    node.depth,
    node.height,
    node.hoodOverhang,
    node.style,
  ])

  const previewEdgesGeo = useMemo(() => {
    if (!previewGeo) return null
    return new THREE.EdgesGeometry(previewGeo, 25)
  }, [previewGeo])

  const previewFootprintGeo = useMemo(() => {
    const hw = node.width / 2
    const hd = node.depth / 2
    // 4 edges as line-segment pairs (a→b, b→c, c→d, d→a)
    const pts = [
      new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(hw, 0, -hd),
      new THREE.Vector3(hw, 0, -hd),  new THREE.Vector3(hw, 0, hd),
      new THREE.Vector3(hw, 0, hd),   new THREE.Vector3(-hw, 0, hd),
      new THREE.Vector3(-hw, 0, hd),  new THREE.Vector3(-hw, 0, -hd),
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [node.width, node.depth])

  useEffect(() => {
    return () => {
      previewGeo?.dispose()
      previewEdgesGeo?.dispose()
      previewFootprintGeo?.dispose()
    }
  }, [previewGeo, previewEdgesGeo, previewFootprintGeo])

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
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      visible: node.visible,
      metadata: node.metadata,
    }

    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const ventObj = sceneRegistry.nodes.get(node.id)
    if (ventObj) ventObj.visible = false

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

    const computeOrientation = (roofNode: RoofNode, wx: number, wy: number, wz: number) => {
      const st = useScene.getState()
      const hit = resolveSegmentFromWorldPoint(roofNode, wx, wy, wz, st)
      if (!hit) return { tilt: 0, segYaw: 0 }
      const seg = hit.segment
      const slopeAngle =
        seg.roofType === 'flat' ? 0 : Math.atan2(seg.roofHeight, seg.depth / 2)
      const tilt =
        hit.localZ === 0 ? 0 : hit.localZ > 0 ? slopeAngle : -slopeAngle
      const segYaw = (roofNode.rotation ?? 0) + (seg.rotation ?? 0)
      return { tilt, segYaw }
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

      const orient = computeOrientation(event.node as RoofNode, wx, wy, wz)
      setPreviewTilt(orient.tilt)
      setPreviewSegYaw(orient.segYaw)
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      const wx = event.position[0]
      const wy = event.position[1]
      const wz = event.position[2]
      const orient = computeOrientation(event.node as RoofNode, wx, wy, wz)
      setPreviewTilt(orient.tilt)
      setPreviewSegYaw(orient.segYaw)
      setPreviewPos(worldToBuildingLocal(wx, wy, wz))
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
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: finalRotation,
        visible: true,
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
    <group position={previewPos} ref={previewRef}>
      <group rotation-y={previewSegYaw}>
        <group rotation-x={previewTilt}>
          {previewFootprintGeo && (
            <lineSegments
              geometry={previewFootprintGeo}
              layers={EDITOR_LAYER}
              material={previewFootprintMaterial}
              renderOrder={999}
            />
          )}
          <group rotation-y={node.rotation ?? 0}>
            <mesh
              geometry={previewGeo}
              layers={EDITOR_LAYER}
              material={previewMaterial}
            />
            {previewEdgesGeo && (
              <lineSegments
                geometry={previewEdgesGeo}
                layers={EDITOR_LAYER}
                material={previewEdgeMaterial}
                renderOrder={1000}
              />
            )}
          </group>
        </group>
      </group>
    </group>
  )
}

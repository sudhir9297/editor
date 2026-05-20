import '../../../three-types'

import {
  type AnyNodeId,
  type DormerNode,
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
  color: 0x88_88_88,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
})

export function MoveDormerTool({ node }: { node: DormerNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  const [previewRotY, setPreviewRotY] = useState(0)
  const [hasHit, setHasHit] = useState(false)

  const previewGeo = useMemo(() => {
    const w = Math.max(0.01, Number.isFinite(node.width) ? node.width : 2)
    const wallH = Math.max(0.01, Number.isFinite(node.height) ? node.height : 1.2)
    const roofH = Math.max(0, Number.isFinite(node.roofHeight) ? node.roofHeight : 0.6)
    const d = Math.max(0.01, Number.isFinite(node.depth) ? node.depth : 1.5)
    const hw = w / 2

    const dropBelow = 2

    const shape = new THREE.Shape()
    shape.moveTo(-hw, -dropBelow)
    shape.lineTo(hw, -dropBelow)
    shape.lineTo(hw, wallH)
    shape.lineTo(0, wallH + roofH)
    shape.lineTo(-hw, wallH)
    shape.closePath()

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: false,
    })
    geo.translate(0, 0, -d / 2)
    return geo
  }, [node.width, node.depth, node.height, node.roofHeight])

  useEffect(() => {
    return () => {
      previewGeo.dispose()
    }
  }, [previewGeo])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const original = {
      position: [...node.position] as [number, number, number],
      rotation: node.rotation ?? 0,
      roofSegmentId: node.roofSegmentId,
      parentId: node.parentId,
      metadata: node.metadata,
    }

    let wasCancelled = false

    const meta =
      typeof node.metadata === 'object' && node.metadata !== null
        ? (node.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const dormerObj = sceneRegistry.nodes.get(node.id)
    if (dormerObj) dormerObj.visible = false

    const worldToBuildingLocal = (
      wx: number,
      wy: number,
      wz: number,
    ): [number, number, number] => {
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
    let lastWorldNormal: THREE.Vector3 | undefined

    const captureNormal = (event: RoofEvent) => {
      if (!event.normal) return
      const n = new THREE.Vector3(event.normal[0], event.normal[1], event.normal[2])
      const nm = new THREE.Matrix3().getNormalMatrix(event.object.matrixWorld)
      n.applyMatrix3(nm).normalize()
      lastWorldNormal = n
    }

    const computeSegmentWorldRotY = (event: RoofEvent): number => {
      const roof = event.node as RoofNode
      const st = useScene.getState()
      const hit = resolveSegmentFromWorldPoint(
        roof,
        event.position[0],
        event.position[1],
        event.position[2],
        st,
      )
      if (!hit) return 0
      const segObj = sceneRegistry.nodes.get(hit.segment.id)
      if (!segObj) return 0
      segObj.updateWorldMatrix(true, false)
      const euler = new THREE.Euler().setFromRotationMatrix(segObj.matrixWorld, 'YXZ')
      return euler.y
    }

    const onRoofMove = (event: RoofEvent) => {
      const sx = Math.round(event.position[0] * 20) / 20
      const sz = Math.round(event.position[2] * 20) / 20
      if (sx !== lastSnapX || sz !== lastSnapZ) {
        sfxEmitter.emit('sfx:grid-snap')
        lastSnapX = sx
        lastSnapZ = sz
      }
      captureNormal(event)
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
      setPreviewRotY(computeSegmentWorldRotY(event) + (node.rotation ?? 0))
      setHasHit(true)
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      captureNormal(event)
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
      setPreviewRotY(computeSegmentWorldRotY(event) + (node.rotation ?? 0))
      setHasHit(true)
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
      const finalRotation = original.rotation

      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      useScene.temporal.getState().resume()

      captureNormal(event)
      let worldNormalArr: [number, number, number] | undefined
      if (lastWorldNormal) {
        worldNormalArr = [lastWorldNormal.x, lastWorldNormal.y, lastWorldNormal.z]
      } else {
        const current = st.nodes[node.id as AnyNodeId] as DormerNode | undefined
        worldNormalArr = current?.surfaceNormal as [number, number, number] | undefined
      }

      st.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [hit.localX, hit.localY, hit.localZ],
        rotation: finalRotation,
        surfaceNormal: worldNormalArr,
        visible: true,
        metadata: {},
      })

      useScene.temporal.getState().pause()

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
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })

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

  return (
    <group position={previewPos} ref={previewRef} rotation-y={previewRotY} visible={hasHit}>
      <mesh geometry={previewGeo} layers={EDITOR_LAYER} material={previewMaterial} />
    </group>
  )
}

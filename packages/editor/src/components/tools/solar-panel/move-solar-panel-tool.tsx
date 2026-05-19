import '../../../three-types'

import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  type SolarPanelNode,
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
      // Capture local Y from the raycast hit so the renderer places the panel
      // on the actual shingle surface (deck + shingle thickness on top of the
      // bare rafter). The analytical getSurfaceY ignores those layers and
      // would sink the panel into the roof.
      return { segment: seg, localX: local.x, localY: local.y, localZ: local.z }
    }
  }
  return null
}

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x22_44_88,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
})

export function MoveSolarPanelTool({ node }: { node: SolarPanelNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previewRef = useRef<THREE.Group>(null!)
  const [previewPos, setPreviewPos] = useState<[number, number, number]>([0, 0, 0])
  const [previewQuat, setPreviewQuat] = useState<[number, number, number, number]>([0, 0, 0, 1])
  // Hide ghost until the cursor lands on a roof; otherwise it flashes at the
  // world origin when the tool first mounts (notably for fresh "Add" panels).
  const [hasHit, setHasHit] = useState(false)

  const previewGeo = useMemo(() => {
    const totalW = node.columns * node.panelWidth + (node.columns - 1) * node.gapX
    const totalH = node.rows * node.panelHeight + (node.rows - 1) * node.gapY
    const geo = new THREE.BoxGeometry(totalW, node.frameDepth, totalH)
    geo.translate(0, node.standoffHeight + node.frameDepth / 2, 0)
    return geo
  }, [node.rows, node.columns, node.panelWidth, node.panelHeight, node.gapX, node.gapY, node.frameDepth, node.standoffHeight])

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
    const isNew = !!meta.isNew
    useScene.getState().updateNode(node.id as AnyNodeId, {
      metadata: { ...meta, isTransient: true },
    })

    const panelObj = sceneRegistry.nodes.get(node.id)
    if (panelObj) panelObj.visible = false

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
    let lastWorldNormal: THREE.Vector3 | undefined

    const captureNormal = (event: RoofEvent) => {
      if (!event.normal) return
      const n = new THREE.Vector3(event.normal[0], event.normal[1], event.normal[2])
      const nm = new THREE.Matrix3().getNormalMatrix(event.object.matrixWorld)
      n.applyMatrix3(nm).normalize()
      lastWorldNormal = n

      // Ghost is mounted in world space (ToolManager sits outside any group).
      // Build a "natural" orientation: +Y to normal, +X to horizontal-perp-to-slope.
      // Matches the renderer's surfaceQuatFromWorldNormal so commit == ghost.
      // Forward = right × n (not n × right) so the basis is right-handed —
      // a reflection would feed setFromRotationMatrix garbage and the panel
      // would visibly mis-rotate on every sloped face.
      const up = new THREE.Vector3(0, 1, 0)
      const right = new THREE.Vector3().crossVectors(up, n)
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
      else right.normalize()
      const forward = new THREE.Vector3().crossVectors(right, n).normalize()
      const m = new THREE.Matrix4().makeBasis(right, n, forward)
      const q = new THREE.Quaternion().setFromRotationMatrix(m)
      setPreviewQuat([q.x, q.y, q.z, q.w])
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
      setHasHit(true)
      event.stopPropagation()
    }

    const onRoofEnter = (event: RoofEvent) => {
      captureNormal(event)
      setPreviewPos(worldToBuildingLocal(event.position[0], event.position[1], event.position[2]))
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

      // Yaw is applied INSIDE the surface group (which is aligned to the
      // world-space normal), so it rotates around the panel's world surface
      // normal. No segment.rotation compensation is needed because the
      // renderer's parent-quat inverse step fully cancels the segment frame.
      const finalRotation = original.rotation

      wasCommitted = true

      st.updateNode(node.id as AnyNodeId, {
        position: original.position,
        rotation: original.rotation,
        roofSegmentId: original.roofSegmentId as AnyNodeId | undefined,
        parentId: original.parentId as AnyNodeId | undefined,
        metadata: original.metadata,
      })
      useScene.temporal.getState().resume()

      captureNormal(event)
      // Store the world-space normal. The renderer will convert it into its
      // local frame at render time using its actual parent's world quaternion,
      // which avoids any drift between assumed parent chain and the real one.
      // If captureNormal didn't have a face on this event, fall back to the
      // previously stored surfaceNormal on the node so we never blank out a
      // previously good value.
      let worldNormalArr: [number, number, number] | undefined
      if (lastWorldNormal) {
        worldNormalArr = [lastWorldNormal.x, lastWorldNormal.y, lastWorldNormal.z]
      } else {
        const current = st.nodes[node.id as AnyNodeId] as SolarPanelNode | undefined
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

      if (isNew) {
        // Fresh panel from "Add Solar Panel" — never committed to a real
        // location. Delete it rather than leaving an invisible, mis-parented
        // panel on segments[0].
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

      // Don't auto-restore or auto-delete in cleanup: React StrictMode runs
      // setup → cleanup → setup in development, and a cleanup-side delete
      // would nuke a freshly-created `isNew` panel before the user can click.
      // Explicit commit (onRoofClick) and explicit cancel (onCancel) handle
      // both states. If the tool unmounts for some other reason (route change,
      // tool switch), a non-new panel stays at its original transform — the
      // isTransient metadata flag is left for a future garbage-collection pass
      // if we add one.
      const obj = sceneRegistry.nodes.get(node.id)
      if (obj) obj.visible = true
      useScene.temporal.getState().resume()
    }
  }, [exitMoveMode, node])

  return (
    <group position={previewPos} quaternion={previewQuat} ref={previewRef} visible={hasHit}>
      <group rotation-y={node.rotation ?? 0}>
        <mesh
          geometry={previewGeo}
          layers={EDITOR_LAYER}
          material={previewMaterial}
        />
      </group>
    </group>
  )
}

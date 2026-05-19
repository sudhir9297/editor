'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { Vector3 } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function DormerPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DormerNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<DormerNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as DormerNode) : storeNode

  const previewProp = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      if (node?.roofSegmentId) {
        useScene.getState().dirtyNodes.add(node.roofSegmentId as AnyNodeId)
      }
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [node?.roofSegmentId, selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.roofSegmentId) {
      setSelection({ selectedIds: [node.roofSegmentId as AnyNode['id']] })
    }
  }, [node?.roofSegmentId, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    const segmentId = node.roofSegmentId
    if (segmentId) {
      const state = useScene.getState()
      const segment = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
      if (segment) {
        state.updateNode(segmentId as AnyNode['id'], {
          children: (segment.children ?? []).filter((id) => id !== selectedId),
        })
      }
    }
    deleteNode(selectedId as AnyNodeId)
    if (segmentId) {
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'dormer' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  const dormerObj = sceneRegistry.nodes.get(selectedId)
  if (dormerObj) dormerObj.updateWorldMatrix(true, false)

  const computeWorldPos = () => {
    if (!dormerObj) return { x: 0, z: 0 }
    const localPt = new Vector3(node.position[0] ?? 0, 0, node.position[2] ?? 0)
    const worldPt = localPt.applyMatrix4(dormerObj.matrixWorld)
    return { x: worldPt.x, z: worldPt.z }
  }
  const computeWorldRotation = () => {
    if (!dormerObj) return node.rotation ?? 0
    const m = dormerObj.matrixWorld.elements
    const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    return ancestorWorldY + (node.rotation ?? 0)
  }
  const { x: worldX_now, z: worldZ_now } = computeWorldPos()
  const worldRotation_now = computeWorldRotation()

  // Y is independent of the roof surface for dormers — the user moves it
  // explicitly via the Y slider. The segment's world Y is taken from the
  // dormer object's matrixWorld translation (segments only yaw on Y, so the
  // Y column is identity except for the translation).
  const segmentWorldY = dormerObj?.matrixWorld.elements[13] ?? 0
  const worldY_now = segmentWorldY + (node.position[1] ?? 0)
  const segWh = segment?.wallHeight ?? 0.5
  const segRh = segment?.roofHeight ?? 2.5
  const worldMinY = segmentWorldY - 1
  const worldMaxY = segmentWorldY + segWh + segRh + 2

  const findSegmentForWorldPoint = (
    wx: number,
    wz: number,
  ): { segment: RoofSegmentNode; localX: number; localZ: number } | null => {
    const state = useScene.getState()
    const worldPt = new Vector3(wx, 0, wz)
    for (const candidate of Object.values(state.nodes)) {
      if (!candidate || candidate.type !== 'roof-segment') continue
      const seg = candidate as RoofSegmentNode
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

  const worldToSegLocal = (
    wx: number,
    wz: number,
    seg: RoofSegmentNode,
  ): { localX: number; localZ: number } => {
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) return { localX: wx, localZ: wz }
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(new Vector3(wx, 0, wz))
    return { localX: local.x, localZ: local.z }
  }

  let worldMinX = worldX_now - 20
  let worldMaxX = worldX_now + 20
  let worldMinZ = worldZ_now - 20
  let worldMaxZ = worldZ_now + 20
  if (roof) {
    let lo_x = Number.POSITIVE_INFINITY
    let hi_x = Number.NEGATIVE_INFINITY
    let lo_z = Number.POSITIVE_INFINITY
    let hi_z = Number.NEGATIVE_INFINITY
    for (const childId of roof.children ?? []) {
      const seg = scenestate.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
      if (!seg) continue
      const segObj = sceneRegistry.nodes.get(seg.id)
      if (!segObj) continue
      segObj.updateWorldMatrix(true, false)
      const segWorldCenter = new Vector3().applyMatrix4(segObj.matrixWorld)
      const r = Math.hypot(seg.width, seg.depth) / 2
      lo_x = Math.min(lo_x, segWorldCenter.x - r)
      hi_x = Math.max(hi_x, segWorldCenter.x + r)
      lo_z = Math.min(lo_z, segWorldCenter.z - r)
      hi_z = Math.max(hi_z, segWorldCenter.z + r)
    }
    if (Number.isFinite(lo_x)) {
      worldMinX = lo_x
      worldMaxX = hi_x
      worldMinZ = lo_z
      worldMaxZ = hi_z
    }
  }

  const commitWorldPosition = (newWorldX: number, newWorldZ: number) => {
    if (!segment) return
    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
      const oldWorldRotation = worldRotation_now
      const newSegObj = sceneRegistry.nodes.get(target.segment.id)
      let newAncestorWorldY = 0
      if (newSegObj) {
        newSegObj.updateWorldMatrix(true, false)
        const m = newSegObj.matrixWorld.elements
        newAncestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
      }
      const newSegLocalRot = oldWorldRotation - newAncestorWorldY
      const updates: Partial<DormerNode> = {
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, node.position[1] ?? 0, target.localZ],
        rotation: newSegLocalRot,
      }
      updateNode(selectedId as AnyNode['id'], updates)
      const state = useScene.getState()
      state.dirtyNodes.add(segment.id as AnyNodeId)
      state.dirtyNodes.add(target.segment.id as AnyNodeId)
      state.dirtyNodes.add(selectedId as AnyNodeId)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    } else {
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, node.position[1] ?? 0, local.localZ] })
    }
  }

  const commitWorldRotation = (newWorldRot: number) => {
    if (!dormerObj) return
    const m = dormerObj.matrixWorld.elements
    const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    commitProp({ rotation: newWorldRot - ancestorWorldY })
  }

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Dormer'}
      width={300}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={6}
          min={0.8}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Depth"
          max={5}
          min={0.6}
          onChange={(v) => previewProp({ depth: v })}
          onCommit={(v) => commitProp({ depth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.depth * 100) / 100}
        />
        <SliderControl
          label="Wall Height"
          max={3}
          min={0.6}
          onChange={(v) => previewProp({ frontWallHeight: v })}
          onCommit={(v) => commitProp({ frontWallHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.frontWallHeight * 100) / 100}
        />
        <SliderControl
          label="Roof Pitch"
          max={60}
          min={10}
          onChange={(v) => previewProp({ roofPitchDeg: v })}
          onCommit={(v) => commitProp({ roofPitchDeg: v })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round(node.roofPitchDeg)}
        />
      </PanelSection>

      <PanelSection title="Roof">
        <SliderControl
          label="Thickness"
          max={0.25}
          min={0.03}
          onChange={(v) => previewProp({ roofThickness: v })}
          onCommit={(v) => commitProp({ roofThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.roofThickness ?? 0.08) * 1000) / 1000}
        />
        <SliderControl
          label="Front Overhang"
          max={0.5}
          min={0}
          onChange={(v) => previewProp({ roofOverhangFront: v })}
          onCommit={(v) => commitProp({ roofOverhangFront: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={Math.round((node.roofOverhangFront ?? 0.15) * 100) / 100}
        />
        <SliderControl
          label="Side Overhang"
          max={0.5}
          min={0}
          onChange={(v) => previewProp({ roofOverhangSides: v })}
          onCommit={(v) => commitProp({ roofOverhangSides: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={Math.round((node.roofOverhangSides ?? 0.1) * 100) / 100}
        />
        <SliderControl
          label="Wall Thickness"
          max={0.4}
          min={0.05}
          onChange={(v) => previewProp({ wallThickness: v })}
          onCommit={(v) => commitProp({ wallThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.wallThickness ?? 0.15) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Window">
        <SegmentedControl
          onChange={(v) => commitProp({ hasWindow: v === 'yes' })}
          options={[
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ]}
          value={(node.hasWindow ?? true) ? 'yes' : 'no'}
        />
        {(node.hasWindow ?? true) && (
          <>
            <SliderControl
              label="Width"
              max={Math.max(0.4, node.width - 0.4)}
              min={0.3}
              onChange={(v) => previewProp({ windowWidth: v })}
              onCommit={(v) => commitProp({ windowWidth: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round((node.windowWidth ?? 1.2) * 100) / 100}
            />
            <SliderControl
              label="Height"
              max={Math.max(0.4, node.frontWallHeight - 0.2)}
              min={0.3}
              onChange={(v) => previewProp({ windowHeight: v })}
              onCommit={(v) => commitProp({ windowHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round((node.windowHeight ?? 0.9) * 100) / 100}
            />
            <SliderControl
              label="Sill Height"
              max={Math.max(0.1, node.frontWallHeight - 0.4)}
              min={0.05}
              onChange={(v) => previewProp({ windowSillHeight: v })}
              onCommit={(v) => commitProp({ windowSillHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round((node.windowSillHeight ?? 0.3) * 100) / 100}
            />
            <SliderControl
              label="Frame Thickness"
              max={0.15}
              min={0.02}
              onChange={(v) => previewProp({ windowFrameThickness: v })}
              onCommit={(v) => commitProp({ windowFrameThickness: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round((node.windowFrameThickness ?? 0.05) * 1000) / 1000}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={Math.round(worldMaxX * 10) / 10}
          min={Math.round(worldMinX * 10) / 10}
          onChange={(newWorldX) => {
            if (!segment) return
            const local = worldToSegLocal(newWorldX, worldZ_now, segment)
            previewProp({ position: [local.localX, node.position[1] ?? 0, local.localZ] })
          }}
          onCommit={(newWorldX) => commitWorldPosition(newWorldX, worldZ_now)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldX_now * 100) / 100}
        />
        <SliderControl
          label="Y"
          max={Math.round(worldMaxY * 10) / 10}
          min={Math.round(worldMinY * 10) / 10}
          onChange={(newWorldY) => {
            const localY = newWorldY - segmentWorldY
            previewProp({
              position: [node.position[0] ?? 0, localY, node.position[2] ?? 0],
            })
          }}
          onCommit={(newWorldY) => {
            const localY = newWorldY - segmentWorldY
            commitProp({
              position: [node.position[0] ?? 0, localY, node.position[2] ?? 0],
            })
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldY_now * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={Math.round(worldMaxZ * 10) / 10}
          min={Math.round(worldMinZ * 10) / 10}
          onChange={(newWorldZ) => {
            if (!segment) return
            const local = worldToSegLocal(worldX_now, newWorldZ, segment)
            previewProp({ position: [local.localX, node.position[1] ?? 0, local.localZ] })
          }}
          onCommit={(newWorldZ) => commitWorldPosition(worldX_now, newWorldZ)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldZ_now * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => {
            const newWorldRot = (degrees * Math.PI) / 180
            if (!dormerObj) return
            const m = dormerObj.matrixWorld.elements
            const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
            previewProp({ rotation: newWorldRot - ancestorWorldY })
          }}
          onCommit={(degrees) => commitWorldRotation((degrees * Math.PI) / 180)}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round((worldRotation_now * 180) / Math.PI)}
        />
      </PanelSection>

      <PanelSection title="Cutout">
        <SliderControl
          label="Offset"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ cutoutOffset: v })}
          onCommit={(v) => commitProp({ cutoutOffset: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.cutoutOffset ?? 0.01) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

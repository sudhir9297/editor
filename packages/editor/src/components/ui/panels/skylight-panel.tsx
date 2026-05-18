'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  type SkylightNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function SkylightPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SkylightNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<SkylightNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as SkylightNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const previewProp = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      if (updates.roofSegmentId !== undefined) {
        const state = useScene.getState()
        const prev = node?.roofSegmentId
        if (prev) state.dirtyNodes.add(prev as AnyNodeId)
        state.dirtyNodes.add(updates.roofSegmentId as AnyNodeId)
        state.dirtyNodes.add(selectedId as AnyNodeId)
      }
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [node, selectedId, updateNode],
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

  if (!(node && node.type === 'skylight' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined
  const roofPos = roof?.position ?? [0, 0, 0]
  const roofRot = roof?.rotation ?? 0

  const segCos = Math.cos(segment?.rotation ?? 0)
  const segSin = Math.sin(segment?.rotation ?? 0)
  const roofCos = Math.cos(roofRot)
  const roofSin = Math.sin(roofRot)

  const roofLocalX_now =
    (segment?.position[0] ?? 0) + node.position[0] * segCos - node.position[2] * segSin
  const roofLocalZ_now =
    (segment?.position[2] ?? 0) + node.position[0] * segSin + node.position[2] * segCos
  const worldX_now = roofPos[0] + roofLocalX_now * roofCos - roofLocalZ_now * roofSin
  const worldZ_now = roofPos[2] + roofLocalX_now * roofSin + roofLocalZ_now * roofCos
  const worldRotation_now = roofRot + (segment?.rotation ?? 0) + (node.rotation ?? 0)

  const findSegmentForWorldPoint = (
    wx: number,
    wz: number,
  ): { segment: RoofSegmentNode; localX: number; localZ: number } | null => {
    const state = useScene.getState()
    for (const candidate of Object.values(state.nodes)) {
      if (!candidate || candidate.type !== 'roof-segment') continue
      const seg = candidate as RoofSegmentNode
      const segRoof = seg.parentId
        ? (state.nodes[seg.parentId as AnyNodeId] as RoofNode | undefined)
        : undefined
      const sRoofPos = segRoof?.position ?? [0, 0, 0]
      const sRoofRot = segRoof?.rotation ?? 0
      const dx = wx - sRoofPos[0]
      const dz = wz - sRoofPos[2]
      const rcos = Math.cos(sRoofRot)
      const rsin = Math.sin(sRoofRot)
      const rlx = dx * rcos + dz * rsin
      const rlz = -dx * rsin + dz * rcos
      const drx = rlx - seg.position[0]
      const drz = rlz - seg.position[2]
      const scos = Math.cos(seg.rotation)
      const ssin = Math.sin(seg.rotation)
      const lx = drx * scos + drz * ssin
      const lz = -drx * ssin + drz * scos
      if (Math.abs(lx) <= seg.width / 2 && Math.abs(lz) <= seg.depth / 2) {
        return { segment: seg, localX: lx, localZ: lz }
      }
    }
    return null
  }

  const worldToSegLocal = (
    wx: number,
    wz: number,
    seg: RoofSegmentNode,
  ): { localX: number; localZ: number } => {
    const segRoof = seg.parentId
      ? (scenestate.nodes[seg.parentId as AnyNodeId] as RoofNode | undefined)
      : undefined
    const sRoofPos = segRoof?.position ?? [0, 0, 0]
    const sRoofRot = segRoof?.rotation ?? 0
    const dx = wx - sRoofPos[0]
    const dz = wz - sRoofPos[2]
    const rcos = Math.cos(sRoofRot)
    const rsin = Math.sin(sRoofRot)
    const rlx = dx * rcos + dz * rsin
    const rlz = -dx * rsin + dz * rcos
    const drx = rlx - seg.position[0]
    const drz = rlz - seg.position[2]
    const scos = Math.cos(seg.rotation)
    const ssin = Math.sin(seg.rotation)
    return {
      localX: drx * scos + drz * ssin,
      localZ: -drx * ssin + drz * scos,
    }
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
      const r = Math.hypot(seg.width, seg.depth) / 2
      lo_x = Math.min(lo_x, seg.position[0] - r)
      hi_x = Math.max(hi_x, seg.position[0] + r)
      lo_z = Math.min(lo_z, seg.position[2] - r)
      hi_z = Math.max(hi_z, seg.position[2] + r)
    }
    if (Number.isFinite(lo_x)) {
      worldMinX = roofPos[0] + lo_x
      worldMaxX = roofPos[0] + hi_x
      worldMinZ = roofPos[2] + lo_z
      worldMaxZ = roofPos[2] + hi_z
    }
  }

  const commitWorldPosition = (newWorldX: number, newWorldZ: number) => {
    if (!segment) return
    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
      const oldWorldRotation = worldRotation_now
      const newRoof = target.segment.parentId
        ? (scenestate.nodes[target.segment.parentId as AnyNodeId] as RoofNode | undefined)
        : undefined
      const newSegLocalRot =
        oldWorldRotation - (newRoof?.rotation ?? 0) - target.segment.rotation
      commitProp({
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, 0, target.localZ],
        rotation: newSegLocalRot,
      } as Partial<SkylightNode>)
    } else {
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, 0, local.localZ] })
    }
  }

  const commitWorldRotation = (newWorldRot: number) => {
    if (!segment) return
    const segLocalRot = newWorldRot - roofRot - segment.rotation
    commitProp({ rotation: segLocalRot })
  }

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Skylight'}
      width={300}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.3}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={3}
          min={0.3}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => commitProp({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          max={0.2}
          min={0.02}
          onChange={(v) => previewProp({ frameThickness: v })}
          onCommit={(v) => commitProp({ frameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.frameThickness ?? 0.05) * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.3}
          min={0.02}
          onChange={(v) => previewProp({ frameDepth: v })}
          onCommit={(v) => commitProp({ frameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.frameDepth ?? 0.1) * 1000) / 1000}
        />
        <SliderControl
          label="Cutout Offset"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ cutoutOffset: v })}
          onCommit={(v) => commitProp({ cutoutOffset: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.cutoutOffset ?? 0.02) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Style">
        <SegmentedControl
          onChange={(v) => handleUpdate({ skylightType: v })}
          options={[
            { label: 'Fixed', value: 'fixed' },
            { label: 'Vented', value: 'vented' },
          ]}
          value={node.skylightType ?? 'fixed'}
        />
      </PanelSection>

      <PanelSection title="Curb">
        <SegmentedControl
          onChange={(v) => handleUpdate({ curb: v === 'yes' })}
          options={[
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ]}
          value={(node.curb ?? true) ? 'yes' : 'no'}
        />
        {(node.curb ?? true) && (
          <SliderControl
            label="Height"
            max={0.3}
            min={0.02}
            onChange={(v) => previewProp({ curbHeight: v })}
            onCommit={(v) => commitProp({ curbHeight: v })}
            precision={3}
            restoreOnCommit={false}
            step={0.005}
            unit="m"
            value={Math.round((node.curbHeight ?? 0.1) * 1000) / 1000}
          />
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
            previewProp({ position: [local.localX, 0, local.localZ] })
          }}
          onCommit={(newWorldX) => commitWorldPosition(newWorldX, worldZ_now)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldX_now * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={Math.round(worldMaxZ * 10) / 10}
          min={Math.round(worldMinZ * 10) / 10}
          onChange={(newWorldZ) => {
            if (!segment) return
            const local = worldToSegLocal(worldX_now, newWorldZ, segment)
            previewProp({ position: [local.localX, 0, local.localZ] })
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
            const segLocalRot = newWorldRot - roofRot - (segment?.rotation ?? 0)
            previewProp({ rotation: segLocalRot })
          }}
          onCommit={(degrees) => commitWorldRotation((degrees * Math.PI) / 180)}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round((worldRotation_now * 180) / Math.PI)}
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

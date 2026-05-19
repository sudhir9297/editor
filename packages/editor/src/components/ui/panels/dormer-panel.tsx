'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  type RoofType,
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
import { ToggleControl } from '../controls/toggle-control'
import { PanelWrapper } from './panel-wrapper'

const ROOF_TYPE_OPTIONS: { label: string; value: RoofType }[] = [
  { label: 'Gable', value: 'gable' },
  { label: 'Hip', value: 'hip' },
  { label: 'Shed', value: 'shed' },
  { label: 'Flat', value: 'flat' },
]

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
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
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
  const { x: worldX_now, z: worldZ_now } = computeWorldPos()
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
      const updates: Partial<DormerNode> = {
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, node.position[1] ?? 0, target.localZ],
      }
      updateNode(selectedId as AnyNode['id'], updates)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    } else {
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, node.position[1] ?? 0, local.localZ] })
    }
  }

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Dormer'}
      width={300}
    >
      <PanelSection title="Dormer Type">
        <SegmentedControl
          onChange={(v) => commitProp({ roofType: v })}
          options={ROOF_TYPE_OPTIONS}
          value={node.roofType}
        />
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={6}
          min={0.2}
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
          min={0.2}
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
          max={5}
          min={0.2}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => commitProp({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
        <SliderControl
          label="Roof Height"
          max={3}
          min={0}
          onChange={(v) => previewProp({ roofHeight: v })}
          onCommit={(v) => commitProp({ roofHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.roofHeight ?? 0.6) * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Window">
        {/* Shape */}
        <div className="mb-1 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Shape
        </div>
        <SegmentedControl
          onChange={(v) => commitProp({ windowShape: v as 'rectangle' | 'rounded' | 'arch' })}
          options={[
            { label: 'Rect', value: 'rectangle' },
            { label: 'Rounded', value: 'rounded' },
            { label: 'Arch', value: 'arch' },
          ]}
          value={node.windowShape ?? 'rectangle'}
        />
        {(node.windowShape ?? 'rectangle') === 'arch' && (
          <SliderControl
            label="Arch Height"
            max={Math.max(node.windowHeight ?? 1.2, 0.05)}
            min={0.05}
            onChange={(v) => previewProp({ windowArchHeight: v })}
            onCommit={(v) => commitProp({ windowArchHeight: v })}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={Math.round((node.windowArchHeight ?? 0.35) * 100) / 100}
          />
        )}
        {(node.windowShape ?? 'rectangle') === 'rounded' && (() => {
          const radiusMode = node.windowRadiusMode ?? 'all'
          const maxR = Math.min((node.windowWidth ?? 1.2) / 2, (node.windowHeight ?? 1.2) / 2)
          const radii = node.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15]
          const cornerLabels = [
            ['Top Left', 0],
            ['Top Right', 1],
            ['Bottom Right', 2],
            ['Bottom Left', 3],
          ] as const
          return (
            <div className="mt-1 flex flex-col gap-1">
              <SegmentedControl
                onChange={(v) => commitProp({ windowRadiusMode: v as 'all' | 'individual' })}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Individual', value: 'individual' },
                ]}
                value={radiusMode}
              />
              {radiusMode === 'all' ? (
                <SliderControl
                  label="Radius"
                  max={maxR}
                  min={0}
                  onChange={(v) => previewProp({ windowCornerRadius: v })}
                  onCommit={(v) => commitProp({ windowCornerRadius: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.windowCornerRadius ?? 0.15) * 100) / 100}
                />
              ) : (
                <>
                  {cornerLabels.map(([label, idx]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxR}
                      min={0}
                      onChange={(v) => {
                        const next = [...radii] as [number, number, number, number]
                        next[idx] = v
                        previewProp({ windowCornerRadii: next })
                      }}
                      onCommit={(v) => {
                        const next = [...radii] as [number, number, number, number]
                        next[idx] = v
                        commitProp({ windowCornerRadii: next })
                      }}
                      precision={2}
                      restoreOnCommit={false}
                      step={0.01}
                      unit="m"
                      value={Math.round((radii[idx] ?? 0.15) * 100) / 100}
                    />
                  ))}
                </>
              )}
            </div>
          )
        })()}

        {/* Dimensions */}
        <div className="mt-2 mb-1 border-border/50 border-t pt-2 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Dimensions
        </div>
        <SliderControl
          label="Width"
          max={Math.max(node.width - 0.1, 0.2)}
          min={0.1}
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
          max={1.9}
          min={0.1}
          onChange={(v) => previewProp({ windowHeight: v })}
          onCommit={(v) => commitProp({ windowHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.windowHeight ?? 1.2) * 100) / 100}
        />

        {/* Position */}
        <div className="mt-2 mb-1 border-border/50 border-t pt-2 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Position
        </div>
        <SliderControl
          label={<>X<sub className="ml-[1px] text-[11px] opacity-70">offset</sub></>}
          max={node.width / 2}
          min={-node.width / 2}
          onChange={(v) => previewProp({ windowOffsetX: v })}
          onCommit={(v) => commitProp({ windowOffsetX: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.windowOffsetX ?? 0) * 100) / 100}
        />
        <SliderControl
          label={<>Y<sub className="ml-[1px] text-[11px] opacity-70">offset</sub></>}
          max={0.5}
          min={-0.5}
          onChange={(v) => previewProp({ windowOffsetY: v })}
          onCommit={(v) => commitProp({ windowOffsetY: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.windowOffsetY ?? 0) * 100) / 100}
        />

        {/* Frame */}
        <div className="mt-2 mb-1 border-border/50 border-t pt-2 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Frame
        </div>
        <SliderControl
          label="Thickness"
          max={0.2}
          min={0.01}
          onChange={(v) => previewProp({ windowFrameThickness: v })}
          onCommit={(v) => commitProp({ windowFrameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.windowFrameThickness ?? 0.05) * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.2}
          min={0.01}
          onChange={(v) => previewProp({ windowFrameDepth: v })}
          onCommit={(v) => commitProp({ windowFrameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.windowFrameDepth ?? 0.06) * 1000) / 1000}
        />

        {/* Grid */}
        <div className="mt-2 mb-1 border-border/50 border-t pt-2 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Grid
        </div>
        <SliderControl
          label="Columns"
          max={8}
          min={1}
          onChange={(v) => commitProp({ windowColumns: Math.max(1, Math.min(8, Math.round(v))) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.windowColumns ?? 1}
        />
        <SliderControl
          label="Rows"
          max={8}
          min={1}
          onChange={(v) => commitProp({ windowRows: Math.max(1, Math.min(8, Math.round(v))) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.windowRows ?? 1}
        />
        {((node.windowColumns ?? 1) > 1 || (node.windowRows ?? 1) > 1) && (
          <SliderControl
            label="Divider"
            max={0.1}
            min={0.005}
            onChange={(v) => previewProp({ windowDividerThickness: v })}
            onCommit={(v) => commitProp({ windowDividerThickness: v })}
            precision={3}
            restoreOnCommit={false}
            step={0.005}
            unit="m"
            value={Math.round((node.windowDividerThickness ?? 0.02) * 1000) / 1000}
          />
        )}

        {/* Sill */}
        <div className="mt-2 mb-1 border-border/50 border-t pt-2 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Sill
        </div>
        <ToggleControl
          checked={node.windowSill ?? true}
          label="Enable Sill"
          onChange={(checked) => commitProp({ windowSill: checked })}
        />
        {(node.windowSill ?? true) && (
          <>
            <SliderControl
              label="Depth"
              max={0.3}
              min={0.01}
              onChange={(v) => previewProp({ windowSillDepth: v })}
              onCommit={(v) => commitProp({ windowSillDepth: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.01}
              unit="m"
              value={Math.round((node.windowSillDepth ?? 0.08) * 1000) / 1000}
            />
            <SliderControl
              label="Thickness"
              max={0.1}
              min={0.01}
              onChange={(v) => previewProp({ windowSillThickness: v })}
              onCommit={(v) => commitProp({ windowSillThickness: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round((node.windowSillThickness ?? 0.03) * 1000) / 1000}
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

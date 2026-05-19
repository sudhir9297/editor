'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofSegmentNode,
  type SolarPanelNode,
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

export function SolarPanelPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SolarPanelNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<SolarPanelNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as SolarPanelNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const previewProp = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<SolarPanelNode>) => {
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
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'solar-panel' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Solar Panel'}
      width={300}
    >
      <PanelSection title="Grid Layout">
        <SliderControl
          label="Rows"
          max={20}
          min={1}
          onChange={(v) => previewProp({ rows: Math.round(v) })}
          onCommit={(v) => commitProp({ rows: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.rows}
        />
        <SliderControl
          label="Columns"
          max={20}
          min={1}
          onChange={(v) => previewProp({ columns: Math.round(v) })}
          onCommit={(v) => commitProp({ columns: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.columns}
        />
      </PanelSection>

      <PanelSection title="Panel Size">
        <SliderControl
          label="Width"
          max={2.5}
          min={0.3}
          onChange={(v) => previewProp({ panelWidth: v })}
          onCommit={(v) => commitProp({ panelWidth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.panelWidth * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={3}
          min={0.3}
          onChange={(v) => previewProp({ panelHeight: v })}
          onCommit={(v) => commitProp({ panelHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.panelHeight * 100) / 100}
        />
        <SliderControl
          label="Gap X"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ gapX: v })}
          onCommit={(v) => commitProp({ gapX: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.gapX * 1000) / 1000}
        />
        <SliderControl
          label="Gap Y"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ gapY: v })}
          onCommit={(v) => commitProp({ gapY: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.gapY * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Mounting">
        <SegmentedControl
          onChange={(v) => handleUpdate({ mountingType: v })}
          options={[
            { label: 'Flush', value: 'flush' },
            { label: 'Tilted', value: 'tilted' },
          ]}
          value={node.mountingType ?? 'flush'}
        />
        {node.mountingType === 'tilted' && (
          <SliderControl
            label="Tilt Angle"
            max={45}
            min={0}
            onChange={(v) => previewProp({ tiltAngle: v })}
            onCommit={(v) => commitProp({ tiltAngle: v })}
            precision={0}
            restoreOnCommit={false}
            step={1}
            unit="°"
            value={Math.round(node.tiltAngle)}
          />
        )}
        <SliderControl
          label="Standoff"
          max={0.3}
          min={0}
          onChange={(v) => previewProp({ standoffHeight: v })}
          onCommit={(v) => commitProp({ standoffHeight: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.standoffHeight * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          max={0.1}
          min={0.01}
          onChange={(v) => previewProp({ frameThickness: v })}
          onCommit={(v) => commitProp({ frameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.frameThickness * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.1}
          min={0.01}
          onChange={(v) => previewProp({ frameDepth: v })}
          onCommit={(v) => commitProp({ frameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.frameDepth * 1000) / 1000}
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

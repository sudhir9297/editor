'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RidgeVentNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function RidgeVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RidgeVentNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<RidgeVentNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as RidgeVentNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<RidgeVentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const previewProp = useCallback(
    (updates: Partial<RidgeVentNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<RidgeVentNode>) => {
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

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
    }
  }, [node, setMovingNode])

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

  if (!(node && node.type === 'ridge-vent' && selectedId)) return null

  return (
    <PanelWrapper
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || 'Ridge Vent'}
      width={280}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          max={12}
          min={0.3}
          onChange={(v) => previewProp({ length: v })}
          onCommit={(v) => commitProp({ length: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.length}
        />
        <SliderControl
          label="Width"
          max={1.0}
          min={0.1}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={node.width}
        />
        <SliderControl
          label="Height"
          max={0.3}
          min={0.02}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => commitProp({ height: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={node.height}
        />
      </PanelSection>

      <PanelSection title="Style">
        <SegmentedControl
          onChange={(v) => handleUpdate({ style: v as RidgeVentNode['style'] })}
          options={[
            { label: 'Standard', value: 'standard' },
            { label: 'Shingled', value: 'shingled' },
            { label: 'Metal', value: 'metal' },
          ]}
          value={node.style}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label="Move"
            onClick={handleMove}
          />
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

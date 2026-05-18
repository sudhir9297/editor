'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function ChimneyPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ChimneyNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
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
    // Unlist from host segment's children before deleting the node.
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

  if (!(node && node.type === 'chimney' && selectedId)) return null

  const segment = node.roofSegmentId
    ? (useScene.getState().nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined

  const segHalfW = segment ? segment.width / 2 : 25
  const segHalfD = segment ? segment.depth / 2 : 25

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Chimney'}
      width={300}
    >
      <PanelSection title="Footprint">
        <SliderControl
          label="Width"
          max={3}
          min={0.2}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Depth"
          max={3}
          min={0.2}
          onChange={(v) => handleUpdate({ depth: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.depth * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Height">
        <SliderControl
          label="Above Ridge"
          max={5}
          min={0.1}
          onChange={(v) => handleUpdate({ heightAboveRidge: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.heightAboveRidge * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="U"
          max={segHalfW}
          min={-segHalfW}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="V"
          max={segHalfD}
          min={-segHalfD}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => handleUpdate({ rotation: (degrees * Math.PI) / 180 })}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
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

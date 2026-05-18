'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

type ChimneyType = 'cap' | 'flues' | 'shoulder' | 'bands' | 'cricket' | 'panels'

const CHIMNEY_TYPE_OPTIONS: Array<{ label: string; value: ChimneyType }> = [
  { label: 'Cap', value: 'cap' },
  { label: 'Flues', value: 'flues' },
  { label: 'Shoulder', value: 'shoulder' },
  { label: 'Bands', value: 'bands' },
  { label: 'Cricket', value: 'cricket' },
  { label: 'Panels', value: 'panels' },
]

export function ChimneyPanel() {
  const [chimneyType, setChimneyType] = useState<ChimneyType>('cap')
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ChimneyNode | undefined) : undefined,
  )
  // Merge live overrides so slider displays the value the user is actively
  // dragging, even though the store hasn't been written to yet.
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<ChimneyNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as ChimneyNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  // Slider drag → write live override (mesh updates, store untouched).
  // Slider release → commit to store + clear override.
  const previewProp = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<ChimneyNode>) => {
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
        <SegmentedControl
          onChange={(v) => handleUpdate({ bodyShape: v })}
          options={[
            { label: 'Square', value: 'square' },
            { label: 'Round', value: 'round' },
          ]}
          value={node.bodyShape ?? 'square'}
        />
        <SliderControl
          label={(node.bodyShape ?? 'square') === 'round' ? 'Diameter' : 'Width'}
          max={3}
          min={0.2}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        {(node.bodyShape ?? 'square') !== 'round' && (
          <SliderControl
            label="Depth"
            max={3}
            min={0.2}
            onChange={(v) => previewProp({ depth: v })}
            onCommit={(v) => commitProp({ depth: v })}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={Math.round(node.depth * 100) / 100}
          />
        )}
        <SliderControl
          label="Hollow Depth"
          max={3}
          min={0}
          onChange={(v) => previewProp({ bodyHollowDepth: v })}
          onCommit={(v) => commitProp({ bodyHollowDepth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.bodyHollowDepth ?? 0.6) * 100) / 100}
        />
        <SliderControl
          label="Wall Thickness"
          max={0.3}
          min={0}
          onChange={(v) => previewProp({ bodyHollowMargin: v })}
          onCommit={(v) => commitProp({ bodyHollowMargin: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.bodyHollowMargin ?? 0.08) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Height">
        <SliderControl
          label="Above Ridge"
          max={5}
          min={0.1}
          onChange={(v) => previewProp({ heightAboveRidge: v })}
          onCommit={(v) => commitProp({ heightAboveRidge: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.1}
          unit="m"
          value={Math.round(node.heightAboveRidge * 100) / 100}
        />
        <SliderControl
          label="Cutout Offset"
          max={0.5}
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

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={segHalfW}
          min={-segHalfW}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            previewProp({ position: pos })
          }}
          onCommit={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            commitProp({ position: pos })
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={segHalfD}
          min={-segHalfD}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            previewProp({ position: pos })
          }}
          onCommit={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            commitProp({ position: pos })
          }}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => previewProp({ rotation: (degrees * Math.PI) / 180 })}
          onCommit={(degrees) => commitProp({ rotation: (degrees * Math.PI) / 180 })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
      </PanelSection>

      <PanelSection title="Chimney Type">
        <div className="grid grid-cols-2 gap-1.5 px-1 pt-1">
          {CHIMNEY_TYPE_OPTIONS.filter((option) => {
            // Cricket and Panels both rely on a flat face — hide them for
            // round bodies.
            if ((node.bodyShape ?? 'square') === 'round') {
              return option.value !== 'cricket' && option.value !== 'panels'
            }
            return true
          }).map((option) => {
            const isSelected = chimneyType === option.value
            return (
              <button
                className={cn(
                  'flex min-h-12 items-center rounded-lg border px-2.5 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={option.value}
                onClick={() => setChimneyType(option.value)}
                type="button"
              >
                <span className="truncate font-medium">{option.label}</span>
              </button>
            )
          })}
        </div>

        {chimneyType === 'cap' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ cap: v !== 'none', capShape: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Sloped', value: 'sloped' },
                { label: 'Flat', value: 'flat' },
                { label: 'Stepped', value: 'stepped' },
              ]}
              value={node.capShape ?? 'sloped'}
            />
            {(node.capShape ?? 'sloped') !== 'none' && (
              <>
                <SliderControl
                  label="Overhang"
                  max={0.2}
                  min={0}
                  onChange={(v) => previewProp({ capOverhang: v })}
                  onCommit={(v) => commitProp({ capOverhang: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.capOverhang ?? 0.04) * 1000) / 1000}
                />
                <SliderControl
                  label="Thickness"
                  max={0.3}
                  min={0.02}
                  onChange={(v) => previewProp({ capThickness: v })}
                  onCommit={(v) => commitProp({ capThickness: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.capThickness ?? 0.08) * 1000) / 1000}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'shoulder' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ shoulderStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Tapered', value: 'tapered' },
                { label: 'Corbeled', value: 'corbeled' },
              ]}
              value={node.shoulderStyle ?? 'none'}
            />
            {(node.shoulderStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Height"
                  max={3}
                  min={0.1}
                  onChange={(v) => previewProp({ shoulderHeight: v })}
                  onCommit={(v) => commitProp({ shoulderHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.shoulderHeight ?? 0.5) * 100) / 100}
                />
                <SliderControl
                  label="Extent"
                  max={0.5}
                  min={0}
                  onChange={(v) => previewProp({ shoulderExtent: v })}
                  onCommit={(v) => commitProp({ shoulderExtent: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.shoulderExtent ?? 0.1) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'flues' && (
          <>
            <SliderControl
              label="Count"
              max={4}
              min={0}
              onChange={(v) => previewProp({ flueCount: Math.round(v) })}
              onCommit={(v) => commitProp({ flueCount: Math.round(v) })}
              precision={0}
              restoreOnCommit={false}
              step={1}
              unit=""
              value={node.flueCount ?? 1}
            />
            {(node.flueCount ?? 1) > 0 && (
              <>
                <SegmentedControl
                  onChange={(v) => handleUpdate({ flueShape: v })}
                  options={[
                    { label: 'Round', value: 'round' },
                    { label: 'Square', value: 'square' },
                  ]}
                  value={node.flueShape ?? 'round'}
                />
                <SliderControl
                  label="Diameter"
                  max={Math.max(0.4, node.width)}
                  min={0.05}
                  onChange={(v) => previewProp({ flueDiameter: v })}
                  onCommit={(v) => commitProp({ flueDiameter: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.flueDiameter ?? 0.22) * 100) / 100}
                />
                <SliderControl
                  label="Height"
                  max={1.5}
                  min={0.05}
                  onChange={(v) => previewProp({ flueHeight: v })}
                  onCommit={(v) => commitProp({ flueHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.flueHeight ?? 0.3) * 100) / 100}
                />
                {(node.flueCount ?? 1) > 1 && (
                  <SliderControl
                    label="Spacing"
                    max={1}
                    min={0}
                    onChange={(v) => previewProp({ flueSpacing: v })}
                    onCommit={(v) => commitProp({ flueSpacing: v })}
                    precision={2}
                    restoreOnCommit={false}
                    step={0.05}
                    value={Math.round((node.flueSpacing ?? 1) * 100) / 100}
                  />
                )}
                <SliderControl
                  label="Wall Thickness"
                  max={Math.max(0.1, (node.flueDiameter ?? 0.22) / 2 - 0.01)}
                  min={0}
                  onChange={(v) => previewProp({ flueWallThickness: v })}
                  onCommit={(v) => commitProp({ flueWallThickness: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.flueWallThickness ?? 0.02) * 1000) / 1000}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'bands' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ bandStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Single', value: 'single' },
                { label: 'Double', value: 'double' },
              ]}
              value={node.bandStyle ?? 'none'}
            />
            {(node.bandStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Thickness"
                  max={0.4}
                  min={0.02}
                  onChange={(v) => previewProp({ bandHeight: v })}
                  onCommit={(v) => commitProp({ bandHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.bandHeight ?? 0.1) * 100) / 100}
                />
                <SliderControl
                  label="Extent"
                  max={0.2}
                  min={0}
                  onChange={(v) => previewProp({ bandExtent: v })}
                  onCommit={(v) => commitProp({ bandExtent: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.bandExtent ?? 0.04) * 1000) / 1000}
                />
                <SliderControl
                  label="Offset"
                  max={3}
                  min={0}
                  onChange={(v) => previewProp({ bandOffset: v })}
                  onCommit={(v) => commitProp({ bandOffset: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.bandOffset ?? 0.4) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'cricket' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ cricketStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Simple', value: 'simple' },
              ]}
              value={node.cricketStyle ?? 'none'}
            />
            {(node.cricketStyle ?? 'none') !== 'none' && (
              <>
                <SegmentedControl
                  className="mt-2"
                  onChange={(v) => handleUpdate({ cricketSide: v })}
                  options={[
                    { label: 'Front', value: 'front' },
                    { label: 'Back', value: 'back' },
                  ]}
                  value={node.cricketSide ?? 'front'}
                />
                <SliderControl
                  label="Length"
                  max={2}
                  min={0.1}
                  onChange={(v) => previewProp({ cricketLength: v })}
                  onCommit={(v) => commitProp({ cricketLength: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.cricketLength ?? 0.6) * 100) / 100}
                />
                <SliderControl
                  label="Height"
                  max={1.5}
                  min={0.05}
                  onChange={(v) => previewProp({ cricketHeight: v })}
                  onCommit={(v) => commitProp({ cricketHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.cricketHeight ?? 0.4) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'panels' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ panelStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Rectangular', value: 'rectangular' },
              ]}
              value={node.panelStyle ?? 'none'}
            />
            {(node.panelStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Depth"
                  max={0.15}
                  min={0.005}
                  onChange={(v) => previewProp({ panelDepth: v })}
                  onCommit={(v) => commitProp({ panelDepth: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.panelDepth ?? 0.03) * 1000) / 1000}
                />
                <SliderControl
                  label="Height"
                  max={3}
                  min={0.1}
                  onChange={(v) => previewProp({ panelHeight: v })}
                  onCommit={(v) => commitProp({ panelHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.panelHeight ?? 0.8) * 100) / 100}
                />
                <SliderControl
                  label="Top Offset"
                  max={2}
                  min={0}
                  onChange={(v) => previewProp({ panelOffsetTop: v })}
                  onCommit={(v) => commitProp({ panelOffsetTop: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.panelOffsetTop ?? 0.15) * 100) / 100}
                />
                <SliderControl
                  label="Side Margin"
                  max={Math.max(0.5, node.width / 2 - 0.05)}
                  min={0.02}
                  onChange={(v) => previewProp({ panelMargin: v })}
                  onCommit={(v) => commitProp({ panelMargin: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.panelMargin ?? 0.1) * 100) / 100}
                />
              </>
            )}
          </>
        )}

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

'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofSegmentNode,
  SOLAR_PANEL_PRESET_LABELS,
  SOLAR_PANEL_PRESETS,
  type SolarPanelNode,
  type SolarPanelPresetKey,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { LayoutGrid, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { computeAutoFit, flippedPanelDims } from '../../../lib/solar-panel-layout'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

// Editing any of these clears panelTypePreset back to undefined ("Custom"),
// keeping the schema invariant: a present preset always matches the table.
const PRESET_OWNED_FIELDS: ReadonlyArray<keyof SolarPanelNode> = [
  'panelWidth',
  'panelHeight',
  'frameThickness',
  'frameDepth',
]

// Preset cards rendered as a 2-column grid (same visual pattern as door types).
// "Custom" is shown as inline text below the grid when no preset matches —
// avoids an orphan card in the grid and keeps the chooser tidy.
const PRESET_CARDS: { key: SolarPanelPresetKey; label: string }[] = [
  { key: 'residential', label: SOLAR_PANEL_PRESET_LABELS.residential },
  { key: 'residential-large', label: SOLAR_PANEL_PRESET_LABELS['residential-large'] },
  { key: 'compact', label: SOLAR_PANEL_PRESET_LABELS.compact },
  { key: 'frameless', label: SOLAR_PANEL_PRESET_LABELS.frameless },
]

function dimsTouchedByUpdate(updates: Partial<SolarPanelNode>): boolean {
  for (const field of PRESET_OWNED_FIELDS) {
    if (field in updates) return true
  }
  return false
}

// Safe number coercion for slider `value` props. SliderControl's `useState(value.toFixed(...))`
// initializer throws if value is null/undefined, and NaN renders as the literal
// string "NaN" — so we substitute the schema default whenever the field on a
// legacy panel is missing or non-finite.
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

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
  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // Transient inline message (e.g., "Setbacks too large to fit a panel").
  // Cleared automatically after a short delay so it doesn't linger.
  const [autoFitMessage, setAutoFitMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!autoFitMessage) return
    const t = window.setTimeout(() => setAutoFitMessage(null), 3500)
    return () => window.clearTimeout(t)
  }, [autoFitMessage])

  const handleUpdate = useCallback(
    (updates: Partial<SolarPanelNode>) => {
      if (!selectedId) return
      const next: Partial<SolarPanelNode> = dimsTouchedByUpdate(updates)
        ? { ...updates, panelTypePreset: undefined }
        : updates
      updateNode(selectedId as AnyNode['id'], next)
    },
    [selectedId, updateNode],
  )

  // Inspector-style preview: writes to the transient overlay so dragging a
  // slider doesn't push undo entries on every frame. Note we deliberately do
  // NOT clear panelTypePreset during preview — the schema only updates on
  // commit, so the preset stays consistent until the user lets go.
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
      const next: Partial<SolarPanelNode> = dimsTouchedByUpdate(updates)
        ? { ...updates, panelTypePreset: undefined }
        : updates
      updateNode(selectedId as AnyNode['id'], next)
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

  const handlePresetChange = useCallback(
    (key: SolarPanelPresetKey) => {
      if (!selectedId) return
      const dims = SOLAR_PANEL_PRESETS[key]
      updateNode(selectedId as AnyNode['id'], { panelTypePreset: key, ...dims })
    },
    [selectedId, updateNode],
  )

  const handleFlip = useCallback(() => {
    if (!(selectedId && node)) return
    // Flip is a dim change → clears preset back to Custom (the rotated panel
    // generally doesn't match the canonical portrait preset dims).
    updateNode(selectedId as AnyNode['id'], {
      ...flippedPanelDims(node),
      panelTypePreset: undefined,
    })
  }, [selectedId, node, updateNode])

  const handleAutoFit = useCallback(() => {
    if (!(selectedId && node && segment)) return
    const fit = computeAutoFit(segment, node)
    if (!fit) {
      console.warn('[solar-panel-panel] Auto-fit: setbacks too large for this segment.')
      setAutoFitMessage('Setbacks too large to fit a panel.')
      return
    }
    updateNode(selectedId as AnyNode['id'], { rows: fit.rows, columns: fit.columns })
    setAutoFitMessage(null)
  }, [selectedId, node, segment, updateNode])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    const segmentId = node.roofSegmentId
    if (segmentId) {
      const state = useScene.getState()
      const seg = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
      if (seg) {
        state.updateNode(segmentId as AnyNode['id'], {
          children: (seg.children ?? []).filter((id) => id !== selectedId),
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

  const activePreset = node.panelTypePreset
  const formatDims = (w: number, h: number) =>
    `${w.toFixed(2)} × ${h.toFixed(2)} m`

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Solar Panel'}
      width={300}
    >
      <PanelSection title="Preset">
        <div className="grid grid-cols-2 gap-1.5 px-1 pt-1">
          {PRESET_CARDS.map((card) => {
            const dims = SOLAR_PANEL_PRESETS[card.key]
            const isSelected = activePreset === card.key
            return (
              <button
                className={cn(
                  'flex min-h-14 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={card.key}
                onClick={() => handlePresetChange(card.key)}
                type="button"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{card.label}</span>
                </span>
                <span className="pl-[20px] text-[10px] tabular-nums opacity-70">
                  {formatDims(dims.panelWidth, dims.panelHeight)}
                </span>
              </button>
            )
          })}
        </div>
        {!activePreset && (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            Custom — dimensions don't match any preset
          </p>
        )}
      </PanelSection>

      <PanelSection title="Array">
        <SliderControl
          label="Rows"
          max={20}
          min={1}
          onChange={(v) => previewProp({ rows: Math.round(v) })}
          onCommit={(v) => commitProp({ rows: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={num(node.rows, 4)}
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
          value={num(node.columns, 5)}
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
          value={Math.round(num(node.gapX, 0.02) * 1000) / 1000}
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
          value={Math.round(num(node.gapY, 0.02) * 1000) / 1000}
        />
        <ActionGroup>
          <ActionButton
            disabled={!segment}
            label="Auto-fit to roof"
            onClick={handleAutoFit}
          />
        </ActionGroup>
        {autoFitMessage ? (
          <p className="px-1 text-amber-400 text-xs">{autoFitMessage}</p>
        ) : null}
      </PanelSection>

      <PanelSection title="Panel">
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
          value={Math.round(num(node.panelWidth, 1) * 100) / 100}
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
          value={Math.round(num(node.panelHeight, 1.65) * 100) / 100}
        />
        <ActionGroup>
          <ActionButton label="Flip orientation" onClick={handleFlip} />
        </ActionGroup>
        <SliderControl
          label="Frame thickness"
          max={0.1}
          min={0.005}
          onChange={(v) => previewProp({ frameThickness: v })}
          onCommit={(v) => commitProp({ frameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(num(node.frameThickness, 0.04) * 1000) / 1000}
        />
        <SliderControl
          label="Frame depth"
          max={0.1}
          min={0.005}
          onChange={(v) => previewProp({ frameDepth: v })}
          onCommit={(v) => commitProp({ frameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(num(node.frameDepth, 0.04) * 1000) / 1000}
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
            label="Tilt angle"
            max={45}
            min={0}
            onChange={(v) => previewProp({ tiltAngle: v })}
            onCommit={(v) => commitProp({ tiltAngle: v })}
            precision={0}
            restoreOnCommit={false}
            step={1}
            unit="°"
            value={Math.round(num(node.tiltAngle, 15))}
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
          value={Math.round(num(node.standoffHeight, 0.05) * 1000) / 1000}
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

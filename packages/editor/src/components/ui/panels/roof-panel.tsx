'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BoxVentNode,
  BoxVentNode as BoxVentNodeSchema,
  type ChimneyNode,
  ChimneyNode as ChimneyNodeSchema,
  type DormerNode,
  DormerNode as DormerNodeSchema,
  type RidgeVentNode,
  RidgeVentNode as RidgeVentNodeSchema,
  type RoofNode,
  type SkylightNode,
  SkylightNode as SkylightNodeSchema,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  type SolarPanelNode,
  SolarPanelNode as SolarPanelNodeSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { duplicateRoofSubtree } from '../../../lib/roof-duplication'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function RoofPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const createNode = useScene((s) => s.createNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofNode | undefined) : undefined,
  )
  // Shallow selector — only re-renders when the segment list content changes.
  const segments = useScene(
    useShallow((s) => {
      if (!node) return []
      return (node.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')
    }),
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAddSegment = useCallback(() => {
    if (!node) return
    const segment = RoofSegmentNodeSchema.parse({
      width: 6,
      depth: 6,
      wallHeight: 0.5,
      roofHeight: 2.5,
      roofType: 'gable',
      position: [2, 0, 2],
    })
    createNode(segment, node.id as AnyNodeId)
  }, [node, createNode])

  const handleAddChimney = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) {
      console.warn('[roof-panel] Add Chimney: roof has no segments yet.')
      return
    }
    const chimney = ChimneyNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      metadata: { isNew: true, isTransient: true },
    })
    createNode(chimney, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [chimney.id as AnyNode['id']] })
    setMovingNode(chimney)
  }, [node, segments, createNode, setSelection, setMovingNode])

  const handleAddSkylight = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) return
    const skylight = SkylightNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      metadata: { isNew: true },
    })
    createNode(skylight, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [skylight.id as AnyNode['id']] })
    setMovingNode(skylight)
  }, [node, segments, createNode, setSelection, setMovingNode])

  const handleAddDormer = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) {
      console.warn('[roof-panel] Add Dormer: roof has no segments yet.')
      return
    }
    const dormer = DormerNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      metadata: { isNew: true, isTransient: true },
    })
    createNode(dormer, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [dormer.id as AnyNode['id']] })
    setMovingNode(dormer)
  }, [node, segments, createNode, setSelection, setMovingNode])

  const handleAddSolarPanel = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) {
      console.warn('[roof-panel] Add Solar Panel: roof has no segments yet.')
      return
    }
    // Drop straight into placement mode. The panel is created hidden and
    // host-less-ish (attached to segments[0] as a placeholder so the schema
    // is valid); MoveSolarPanelTool will re-parent it to whichever segment
    // the user actually clicks and orient it from the raycast surface normal.
    // If the user cancels before clicking, the move tool deletes the node
    // (it reads metadata.isNew to know this was a fresh placement).
    const solarPanel = SolarPanelNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      panelTypePreset: 'residential',
      metadata: { isNew: true },
    })
    createNode(solarPanel, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [solarPanel.id as AnyNode['id']] })
    setMovingNode(solarPanel)
  }, [node, segments, createNode, setSelection, setMovingNode])

  const handleAddRidgeVent = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) {
      console.warn('[roof-panel] Add Ridge Vent: roof has no segments yet.')
      return
    }
    const ridgeVent = RidgeVentNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      metadata: { isNew: true, isTransient: true },
    })
    createNode(ridgeVent, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [ridgeVent.id as AnyNode['id']] })
    setMovingNode(ridgeVent)
  }, [node, segments, createNode, setSelection, setMovingNode])

  const handleAddBoxVent = useCallback(() => {
    if (!node) return
    const firstSegment = segments[0]
    if (!firstSegment) {
      console.warn('[roof-panel] Add Box Vent: roof has no segments yet.')
      return
    }
    const boxVent = BoxVentNodeSchema.parse({
      roofSegmentId: firstSegment.id,
      parentId: firstSegment.id,
      position: [0, 0, 0],
      visible: false,
      metadata: { isNew: true, isTransient: true },
    })
    createNode(boxVent, firstSegment.id as AnyNodeId)
    setSelection({ selectedIds: [boxVent.id as AnyNode['id']] })
    setMovingNode(boxVent)
  }, [node, segments, createNode, setSelection, setMovingNode])

  // Flatten chimneys, skylights, and solar panels hosted by any segment of this roof.
  const chimneys = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: ChimneyNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as ChimneyNode | undefined
          if (child?.type === 'chimney') out.push(child)
        }
      }
      return out
    }),
  )

  const skylights = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: SkylightNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as SkylightNode | undefined
          if (child?.type === 'skylight') out.push(child)
        }
      }
      return out
    }),
  )

  const solarPanels = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: SolarPanelNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as SolarPanelNode | undefined
          if (child?.type === 'solar-panel') out.push(child)
        }
      }
      return out
    }),
  )

  const dormers = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: DormerNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as DormerNode | undefined
          if (child?.type === 'dormer') out.push(child)
        }
      }
      return out
    }),
  )

  const ridgeVents = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: RidgeVentNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as RidgeVentNode | undefined
          if (child?.type === 'ridge-vent') out.push(child)
        }
      }
      return out
    }),
  )

  const boxVents = useScene(
    useShallow((s) => {
      if (!node) return []
      const out: BoxVentNode[] = []
      for (const segmentId of node.children ?? []) {
        const seg = s.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) {
          const child = s.nodes[childId as AnyNodeId] as BoxVentNode | undefined
          if (child?.type === 'box-vent') out.push(child)
        }
      }
      return out
    }),
  )

  const handleSelectSegment = useCallback(
    (segmentId: string) => {
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    },
    [setSelection],
  )

  const handleDuplicate = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')

    try {
      duplicateRoofSubtree(node.id as AnyNodeId, { mode: 'move' })
    } catch (e) {
      console.error('Failed to duplicate roof', e)
    }
  }, [node])

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'roof' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onClose={handleClose}
      title={node.name || 'Roof'}
      width={300}
    >
      <PanelSection title="Segments">
        <div className="flex flex-col gap-1">
          {segments.map((seg, i) => (
            <button
              className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
              key={seg.id}
              onClick={() => handleSelectSegment(seg.id)}
              type="button"
            >
              <span className="truncate">{seg.name || `Segment ${i + 1}`}</span>
              <span className="text-muted-foreground text-xs capitalize">{seg.roofType}</span>
            </button>
          ))}
        </div>
        <ActionGroup>
          <ActionButton
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Add Segment"
            onClick={handleAddSegment}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title="Elements">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {chimneys.map((chimney, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={chimney.id}
                onClick={() => setSelection({ selectedIds: [chimney.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{chimney.name || `Chimney ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">chimney</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Chimney"
                onClick={handleAddChimney}
              />
            </ActionGroup>
          </div>
          <div className="flex flex-col gap-1">
            {skylights.map((skylight, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={skylight.id}
                onClick={() => setSelection({ selectedIds: [skylight.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{skylight.name || `Skylight ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">skylight</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Skylight"
                onClick={handleAddSkylight}
              />
            </ActionGroup>
          </div>
          <div className="flex flex-col gap-1">
            {solarPanels.map((panel, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={panel.id}
                onClick={() => setSelection({ selectedIds: [panel.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{panel.name || `Solar Panel ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">solar panel</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Solar Panel"
                onClick={handleAddSolarPanel}
              />
            </ActionGroup>
          </div>
          <div className="flex flex-col gap-1">
            {dormers.map((dormer, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={dormer.id}
                onClick={() => setSelection({ selectedIds: [dormer.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{dormer.name || `Dormer ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">dormer</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Dormer"
                onClick={handleAddDormer}
              />
            </ActionGroup>
          </div>
          <div className="flex flex-col gap-1">
            {ridgeVents.map((vent, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={vent.id}
                onClick={() => setSelection({ selectedIds: [vent.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{vent.name || `Ridge Vent ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">ridge vent</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Ridge Vent"
                onClick={handleAddRidgeVent}
              />
            </ActionGroup>
          </div>
          <div className="flex flex-col gap-1">
            {boxVents.map((vent, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
                key={vent.id}
                onClick={() => setSelection({ selectedIds: [vent.id as AnyNode['id']] })}
                type="button"
              >
                <span className="truncate">{vent.name || `Box Vent ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">box vent</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                disabled={segments.length === 0}
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Box Vent"
                onClick={handleAddBoxVent}
              />
            </ActionGroup>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={50}
          min={-50}
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
          label="Y"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={50}
          min={-50}
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
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
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

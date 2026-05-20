'use client'

import {
  type AnyNodeId,
  type BoxVentNode,
  BoxVentNode as BoxVentNodeSchema,
  generateId,
  type RidgeVentNode,
  RidgeVentNode as RidgeVentNodeSchema,
  type RoofNode,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'

type VentNode = RidgeVentNode | BoxVentNode

interface Props {
  node: VentNode
}

export function FloatingVentActions({ node }: Props) {
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setSelection = useViewer((s) => s.setSelection)

  const segment = useScene((s) =>
    node.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  const roof = useScene((s) =>
    segment?.parentId ? (s.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined) : undefined,
  )

  const handleMove = useCallback(() => {
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node)
  }, [node, setMovingNode])

  const handleDuplicate = useCallback(() => {
    if (!segment) return
    sfxEmitter.emit('sfx:item-place')
    const state = useScene.getState()

    const offset: [number, number, number] =
      node.type === 'ridge-vent'
        ? [(node.position[0] ?? 0) + node.length + 0.1, node.position[1] ?? 0, node.position[2] ?? 0]
        : [(node.position[0] ?? 0) + node.width + 0.15, node.position[1] ?? 0, node.position[2] ?? 0]

    if (node.type === 'ridge-vent') {
      const duplicated = RidgeVentNodeSchema.parse({
        ...node,
        id: generateId('rvent'),
        position: offset,
        metadata: {},
      })
      state.createNode(duplicated, segment.id as AnyNodeId)
      setSelection({ selectedIds: [duplicated.id] })
    } else {
      const duplicated = BoxVentNodeSchema.parse({
        ...node,
        id: generateId('bvent'),
        position: offset,
        metadata: {},
      })
      state.createNode(duplicated, segment.id as AnyNodeId)
      setSelection({ selectedIds: [duplicated.id] })
    }

    state.dirtyNodes.add(segment.id as AnyNodeId)
  }, [node, segment, setSelection])

  const handleDelete = useCallback(() => {
    sfxEmitter.emit('sfx:item-delete')
    const state = useScene.getState()
    if (segment) {
      state.updateNode(segment.id, {
        children: (segment.children ?? []).filter((id) => id !== node.id),
      })
    }
    state.deleteNode(node.id as AnyNodeId)
    if (segment) {
      state.dirtyNodes.add(segment.id as AnyNodeId)
      setSelection({ selectedIds: [segment.id] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [node, segment, setSelection])

  if (!(segment && roof)) return null

  const ventHeight = node.type === 'ridge-vent' ? node.height : node.height
  const offsetY = ventHeight + 0.25

  return (
    <group position={roof.position} rotation-y={roof.rotation}>
      <group position={segment.position} rotation-y={segment.rotation}>
        <Html
          center
          position={[node.position[0] ?? 0, (node.position[1] ?? 0) + offsetY, node.position[2] ?? 0]}
          style={{ pointerEvents: 'auto', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div
            className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-[#1f1f1f]/95 p-1 shadow-lg backdrop-blur-sm"
            style={{ whiteSpace: 'nowrap' }}
          >
            <FloatingButton
              icon={<Move className="h-3.5 w-3.5" />}
              label="Move"
              onClick={handleMove}
            />
            <FloatingButton
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Duplicate"
              onClick={handleDuplicate}
            />
            <FloatingButton
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              onClick={handleDelete}
            />
          </div>
        </Html>
      </group>
    </group>
  )
}

function FloatingButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      aria-label={label}
      className={
        danger
          ? 'flex h-7 w-7 items-center justify-center rounded text-red-400 transition-colors hover:bg-red-500/20'
          : 'flex h-7 w-7 items-center justify-center rounded text-foreground transition-colors hover:bg-white/10'
      }
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      type="button"
    >
      {icon}
    </button>
  )
}

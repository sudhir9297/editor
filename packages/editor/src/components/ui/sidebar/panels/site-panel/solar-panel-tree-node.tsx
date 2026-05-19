'use client'

import { type AnyNodeId, type SolarPanelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Sun } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface SolarPanelTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const SolarPanelTreeNode = memo(function SolarPanelTreeNode({
  nodeId,
  depth,
  isLast,
}: SolarPanelTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const node = useScene((s) => s.nodes[nodeId as AnyNodeId] as SolarPanelNode | undefined)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleTreeSelection(e, nodeId, useViewer.getState().selection.selectedIds, setSelection)
    },
    [nodeId, setSelection],
  )

  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  if (!node) return null

  const defaultName = `Solar Panel (${node.rows}×${node.columns})`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId as AnyNodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<Sun className="opacity-60" size={14} />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={node.visible !== false}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          nodeId={nodeId as AnyNodeId}
          onStartEditing={handleStartEditing}
          onStopEditing={handleStopEditing}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId as AnyNodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => {}}
    />
  )
})

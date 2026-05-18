import '../../../three-types'

import {
  type AnyNodeId,
  type SkylightNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import { useCallback, useEffect } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'

export function MoveSkylightTool({ node }: { node: SkylightNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false

    const onRoofClick = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const state = useScene.getState()

      const roofLocalX = event.localPosition[0] ?? 0
      const roofLocalZ = event.localPosition[2] ?? 0

      let chosen: { segment: RoofSegmentNode; localX: number; localZ: number } | null = null
      for (const childId of roof.children ?? []) {
        const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
        if (seg?.type !== 'roof-segment') continue
        const rx = roofLocalX - seg.position[0]
        const rz = roofLocalZ - seg.position[2]
        const cos = Math.cos(-seg.rotation)
        const sin = Math.sin(-seg.rotation)
        const lx = rx * cos - rz * sin
        const lz = rx * sin + rz * cos
        if (Math.abs(lx) <= seg.width / 2 && Math.abs(lz) <= seg.depth / 2) {
          chosen = { segment: seg, localX: lx, localZ: lz }
          break
        }
      }

      if (!chosen) return

      const targetSegment = chosen.segment
      const targetSegmentId = targetSegment.id as AnyNodeId
      const previousSegmentId = node.roofSegmentId as AnyNodeId | undefined

      let nextRotation = node.rotation ?? 0
      if (previousSegmentId && previousSegmentId !== targetSegmentId) {
        const prevSeg = state.nodes[previousSegmentId] as RoofSegmentNode | undefined
        if (prevSeg) {
          nextRotation = prevSeg.rotation + (node.rotation ?? 0) - targetSegment.rotation
        }
      }

      state.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [chosen.localX, 0, chosen.localZ],
        rotation: nextRotation,
      })
      if (previousSegmentId) state.dirtyNodes.add(previousSegmentId)
      state.dirtyNodes.add(targetSegmentId)
      state.dirtyNodes.add(node.id as AnyNodeId)

      committed = true
      useScene.temporal.getState().resume()
      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('roof:click', onRoofClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('roof:click', onRoofClick)
      emitter.off('tool:cancel', onCancel)
      if (!committed) {
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node])

  return null
}

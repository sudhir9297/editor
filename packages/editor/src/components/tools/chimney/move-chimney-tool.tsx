import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  type ChimneyNode,
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

// Move tool for chimneys. The user clicks anywhere on a roof — the tool
// resolves which segment of that roof contains the hit point, then re-parents
// the chimney to that segment with the segment-local position derived from
// the cursor.
export function MoveChimneyTool({ node }: { node: ChimneyNode }) {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false

    const onRoofClick = (event: RoofEvent) => {
      const roof = event.node as RoofNode
      const state = useScene.getState()

      // event.localPosition is roof-local (the merged-roof mesh sits at the
      // roof group's origin). Iterate the roof's child segments and find the
      // one whose footprint contains the hit point.
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

      if (!chosen) return // click outside any segment footprint — do nothing

      const targetSegment = chosen.segment
      const targetSegmentId = targetSegment.id as AnyNodeId
      const previousSegmentId = node.roofSegmentId as AnyNodeId | undefined

      // Preserve the chimney's world top Y by adjusting heightAboveRidge, and
      // preserve world rotation by adjusting chimney.rotation, so a move
      // across segments with different wall/roof heights or rotations doesn't
      // make the chimney suddenly tower, sink, or spin.
      const oldHeightAboveRidge = node.heightAboveRidge ?? 1
      const oldChimneyRotation = node.rotation ?? 0
      let nextHeightAboveRidge = oldHeightAboveRidge
      let nextChimneyRotation = oldChimneyRotation
      if (previousSegmentId && previousSegmentId !== targetSegmentId) {
        const prevSeg = state.nodes[previousSegmentId] as RoofSegmentNode | undefined
        if (prevSeg) {
          const prevRoof = (prevSeg.parentId
            ? (state.nodes[prevSeg.parentId as AnyNodeId] as AnyNode | undefined)
            : undefined) as { position?: [number, number, number] } | undefined
          const nextRoof = roof as unknown as { position?: [number, number, number] }
          const prevPeakY =
            prevSeg.wallHeight + (prevSeg.roofType === 'flat' ? 0 : prevSeg.roofHeight)
          const nextPeakY =
            targetSegment.wallHeight +
            (targetSegment.roofType === 'flat' ? 0 : targetSegment.roofHeight)
          const oldTopWorldY =
            (prevRoof?.position?.[1] ?? 0) +
            (prevSeg.position[1] ?? 0) +
            prevPeakY +
            oldHeightAboveRidge
          nextHeightAboveRidge =
            oldTopWorldY -
            (nextRoof.position?.[1] ?? 0) -
            (targetSegment.position[1] ?? 0) -
            nextPeakY
          nextHeightAboveRidge = Math.max(0.1, nextHeightAboveRidge)
          // World rotation = segment.rotation + chimney.rotation. Solve for
          // the new chimney.rotation so the world rotation stays constant.
          nextChimneyRotation =
            prevSeg.rotation + oldChimneyRotation - targetSegment.rotation
        }
      }

      // updateNode handles reparenting (removes from old parent.children, adds
      // to new parent.children) when parentId changes — no manual children
      // edits needed.
      state.updateNode(node.id as AnyNodeId, {
        roofSegmentId: targetSegmentId,
        parentId: targetSegmentId,
        position: [chosen.localX, 0, chosen.localZ],
        rotation: nextChimneyRotation,
        heightAboveRidge: nextHeightAboveRidge,
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

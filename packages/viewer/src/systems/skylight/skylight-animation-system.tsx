import { type AnyNodeId, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

const easeSkylightAnimation = (value: number) => value * value * (3 - 2 * value)

function markSkylightDirty(skylightId: AnyNodeId) {
  useScene.getState().dirtyNodes.add(skylightId)
}

export const SkylightAnimationSystem = () => {
  useFrame(({ clock }) => {
    const interactive = useInteractive.getState()
    const entries = Object.entries(interactive.skylightAnimations)
    if (entries.length === 0) return

    const now = clock.getElapsedTime() * 1000

    for (const [skylightId, animation] of entries) {
      const typedSkylightId = skylightId as AnyNodeId
      const scene = useScene.getState()
      const node = scene.nodes[typedSkylightId]
      if (node?.type !== 'skylight') {
        interactive.cancelSkylightAnimation(typedSkylightId)
        interactive.removeSkylightOpenState(typedSkylightId)
        continue
      }

      const startedAt = animation.startedAt ?? now
      if (animation.startedAt === null) {
        interactive.startSkylightAnimation(typedSkylightId, { ...animation, startedAt })
      }

      const progress = Math.min(1, (now - startedAt) / animation.durationMs)
      const value =
        animation.from + (animation.to - animation.from) * easeSkylightAnimation(progress)
      interactive.setSkylightOpenState(typedSkylightId, { [animation.field]: value })
      markSkylightDirty(typedSkylightId)

      if (progress < 1) continue

      interactive.cancelSkylightAnimation(typedSkylightId)
      if (animation.persist) {
        scene.updateNode(typedSkylightId, { [animation.field]: animation.to })
        interactive.removeSkylightOpenState(typedSkylightId)
        markSkylightDirty(typedSkylightId)
      } else {
        interactive.setSkylightOpenState(typedSkylightId, { [animation.field]: animation.to })
      }
    }
  }, 2)

  return null
}

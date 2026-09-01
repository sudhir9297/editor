'use client'

import { advance, useStore, useThree } from '@react-three/fiber'
import { XR, XROrigin } from '@react-three/xr'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import FrameLimiter from '../components/viewer/frame-limiter'
import { applyViewerCameraClipping, viewerCameraClipping } from '../components/viewer/viewer-camera'
import {
  renderImmersiveXRFrame,
  shouldPauseFrameLimiterForXR,
  takeOverXRFrameLoop,
  type XRFrameLoopRenderer,
} from './frame-loop'
import type { ViewerXRStore } from './store'

function XRFrameLimiter({
  fps,
  paused,
  session,
}: {
  fps: number
  paused: boolean
  session?: XRSession
}) {
  return <FrameLimiter fps={fps} paused={shouldPauseFrameLimiterForXR(paused, session)} />
}

function XRSessionBinding({ session, store }: { session?: XRSession; store: ViewerXRStore }) {
  const renderer = useThree((state) => state.gl)
  const r3fXR = useThree((state) => state.xr)
  const rootStore = useStore()

  useEffect(() => {
    const manager = renderer.xr
    if (!session || manager.getSession() === session) return

    let cancelled = false
    let restoreFrameLoop: (() => void) | undefined
    const state = rootStore.getState()

    void takeOverXRFrameLoop(
      renderer as unknown as XRFrameLoopRenderer,
      r3fXR,
      (time, frame) => {
        const frameState = rootStore.getState()
        advance(time, true, frameState, frame)

        renderImmersiveXRFrame(renderer, frameState.scene, frameState.camera)
      },
      {
        dpr: state.viewport.dpr,
        height: state.size.height,
        width: state.size.width,
      },
    )
      .then((restore) => {
        if (cancelled) {
          restore()
          return
        }
        restoreFrameLoop = restore
        return manager.setSession(session).then(() => {
          applyViewerCameraClipping(manager.getCamera(), true)
          const clipping = viewerCameraClipping(true)
          session.updateRenderState({
            depthFar: clipping.far,
            depthNear: clipping.near,
          })

          // The WebGPU renderer's WebGL backend can omit Three's sessionstart event,
          // which leaves @react-three/xr unaware of controllers and hands.
          if (store.getState().session !== session) {
            manager.dispatchEvent({ type: 'sessionstart' })
          }
        })
      })
      .catch((error: unknown) => {
        console.error('[viewer] Could not attach the WebXR session', error)
        void session.end()
      })

    return () => {
      cancelled = true
      restoreFrameLoop?.()
    }
  }, [renderer, r3fXR, rootStore, session, store])

  return null
}

export function ViewerXRSessionRoot({
  children,
  fps,
  originPosition,
  paused,
  session,
  store,
}: {
  children: ReactNode
  fps: number
  originPosition?: [number, number, number]
  paused: boolean
  session?: XRSession
  store: ViewerXRStore
}) {
  useEffect(
    () => () => {
      void store.getState().session?.end()
    },
    [store],
  )

  return (
    <XR store={store}>
      <XROrigin position={originPosition} />
      <XRSessionBinding session={session} store={store} />
      <XRFrameLimiter fps={fps} paused={paused} session={session} />
      {children}
    </XR>
  )
}

'use client'

import { useFrame } from '@react-three/fiber'
import {
  DefaultXRHand,
  useXR,
  useXRInputSourceState,
  type XRControllerState,
} from '@react-three/xr'
import { type ReactNode, type RefObject, useEffect, useRef } from 'react'
import { type Group, type Object3D, Vector3 } from 'three'
import type { ViewerXRStore } from '../../store'
import { GOD_ORIGIN_POSITION, GOD_ORIGIN_ROTATION } from '../constants/god-mode-constants'
import { GodModeHandInput } from '../input/god-mode-hand-controls'
import {
  applyGodScaleGesture,
  type GodScaleGesture,
  type GodScaleGestureMode,
  isGodScaleInteractionEnabled,
  resetGodScaleRoot,
} from '../lib/scale-interaction'
import { clearGodScaleHandStates, getGodScaleHandState } from '../store/god-mode-hand-store'
import { useGodScaleView } from '../store/god-mode-view-store'

function isControllerGrabPressed(state: XRControllerState | undefined) {
  if (state?.gamepad?.['xr-standard-squeeze']?.state === 'pressed') return true
  return state?.inputSource.gamepad?.buttons[1]?.pressed === true
}

function getGripPosition(
  state: XRControllerState | undefined,
  frame: XRFrame | undefined,
  referenceSpace: XRReferenceSpace | undefined,
  origin: Object3D | undefined,
  target: Vector3,
) {
  if (frame && referenceSpace && state?.inputSource.gripSpace) {
    const pose = frame.getPose(state.inputSource.gripSpace, referenceSpace)
    if (pose) {
      target.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z)
      origin?.localToWorld(target)
      return true
    }
  }

  if (!state?.object) return false
  const gripSpaceObject = state.object.parent ?? state.object
  gripSpaceObject.updateWorldMatrix(true, false)
  gripSpaceObject.getWorldPosition(target)
  return true
}

function resetGestureOnRequest(
  rootRef: RefObject<Object3D | null>,
  gesture: RefObject<GodScaleGesture>,
  resetRequest: number,
  handledResetRequest: RefObject<number>,
) {
  if (handledResetRequest.current === resetRequest || !rootRef.current) return
  resetGodScaleRoot(rootRef.current, gesture.current)
  handledResetRequest.current = resetRequest
}

function GodScaleController({ sceneRootRef }: { sceneRootRef: RefObject<Object3D | null> }) {
  const leftController = useXRInputSourceState('controller', 'left')
  const rightController = useXRInputSourceState('controller', 'right')
  const referenceSpace = useXR((state) => state.originReferenceSpace)
  const origin = useXR((state) => state.origin)
  const resetRequest = useGodScaleView((state) => state.resetRequest)
  const gesture = useRef<GodScaleGesture>({ mode: null })
  const handledResetRequest = useRef(resetRequest)
  const leftPosition = useRef(new Vector3())
  const rightPosition = useRef(new Vector3())
  const nextPosition = useRef(new Vector3())

  useEffect(() => {
    resetGestureOnRequest(sceneRootRef, gesture, resetRequest, handledResetRequest)
  }, [resetRequest, sceneRootRef])

  useFrame((_, __, frame) => {
    const root = sceneRootRef.current
    const leftPressed = isControllerGrabPressed(leftController)
    const rightPressed = isControllerGrabPressed(rightController)
    const mode: GodScaleGestureMode | null =
      leftPressed && rightPressed ? 'two' : leftPressed ? 'left' : rightPressed ? 'right' : null

    if (!root || !isGodScaleInteractionEnabled(mode)) {
      gesture.current.mode = null
      return
    }

    const hasLeftPosition =
      !leftPressed ||
      getGripPosition(leftController, frame, referenceSpace, origin, leftPosition.current)
    const hasRightPosition =
      !rightPressed ||
      getGripPosition(rightController, frame, referenceSpace, origin, rightPosition.current)
    if (!hasLeftPosition || !hasRightPosition) {
      gesture.current.mode = null
      return
    }

    applyGodScaleGesture({
      gesture: gesture.current,
      leftPosition: leftPosition.current,
      mode,
      rightPosition: rightPosition.current,
      root,
      targetPosition: nextPosition.current,
    })
  })

  return null
}

function GodScaleHandController({ sceneRootRef }: { sceneRootRef: RefObject<Object3D | null> }) {
  const resetRequest = useGodScaleView((state) => state.resetRequest)
  const gesture = useRef<GodScaleGesture>({ mode: null })
  const handledResetRequest = useRef(resetRequest)
  const nextPosition = useRef(new Vector3())

  useEffect(() => {
    resetGestureOnRequest(sceneRootRef, gesture, resetRequest, handledResetRequest)
  }, [resetRequest, sceneRootRef])

  useFrame(() => {
    const root = sceneRootRef.current
    const leftHand = getGodScaleHandState('left')
    const rightHand = getGodScaleHandState('right')
    const mode: GodScaleGestureMode | null =
      leftHand.grabbed && rightHand.grabbed
        ? 'two'
        : leftHand.grabbed
          ? 'left'
          : rightHand.grabbed
            ? 'right'
            : null

    if (!root || !isGodScaleInteractionEnabled(mode)) {
      gesture.current.mode = null
      return
    }

    applyGodScaleGesture({
      gesture: gesture.current,
      leftPosition: leftHand.position,
      mode,
      rightPosition: rightHand.position,
      root,
      targetPosition: nextPosition.current,
    })
  })

  return null
}

function GodModeControls({
  sceneRootRef,
  store,
}: {
  sceneRootRef: RefObject<Object3D | null>
  store: ViewerXRStore
}) {
  const origin = useXR((state) => state.origin)
  const resetRequest = useGodScaleView((state) => state.resetRequest)
  const handledResetRequest = useRef(resetRequest)

  useEffect(() => {
    store.setHand(GodModeHandInput)
    return () => {
      clearGodScaleHandStates()
      store.setHand(DefaultXRHand)
    }
  }, [store])

  useEffect(() => {
    if (handledResetRequest.current === resetRequest || !sceneRootRef.current || !origin) return
    resetGodScaleRoot(sceneRootRef.current, { mode: null })
    origin.position.copy(GOD_ORIGIN_POSITION)
    origin.rotation.copy(GOD_ORIGIN_ROTATION)
    handledResetRequest.current = resetRequest
  }, [origin, resetRequest, sceneRootRef])

  return (
    <group name="god-mode-controls">
      <GodScaleController sceneRootRef={sceneRootRef} />
      <GodScaleHandController sceneRootRef={sceneRootRef} />
    </group>
  )
}

export function GodModeScene({ children, store }: { children: ReactNode; store: ViewerXRStore }) {
  const sceneRootRef = useRef<Group | null>(null)

  return (
    <>
      <GodModeControls sceneRootRef={sceneRootRef} store={store} />
      <group name="god-scale-scene-root" ref={sceneRootRef}>
        {children}
      </group>
    </>
  )
}

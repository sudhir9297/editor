import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import useViewer from '../../store/use-viewer'

export function viewerCameraClipping(immersiveXR: boolean) {
  return immersiveXR ? { far: 10_000, near: 0.001 } : { far: 1000, near: 0.1 }
}

export function applyViewerCameraClipping(
  camera: { far: number; near: number; updateProjectionMatrix(): void },
  immersiveXR: boolean,
) {
  const clipping = viewerCameraClipping(immersiveXR)
  camera.far = clipping.far
  camera.near = clipping.near
  camera.updateProjectionMatrix()
}

export function viewerUsesPerspectiveCamera(cameraMode: string, immersiveXR: boolean) {
  return immersiveXR || cameraMode === 'perspective'
}

export const ViewerCamera = ({ immersiveXR = false }: { immersiveXR?: boolean }) => {
  const cameraMode = useViewer((state) => state.cameraMode)
  const clipping = viewerCameraClipping(immersiveXR)

  return viewerUsesPerspectiveCamera(cameraMode, immersiveXR) ? (
    <PerspectiveCamera
      far={clipping.far}
      fov={50}
      makeDefault
      near={clipping.near}
      position={[10, 10, 10]}
    />
  ) : (
    <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
  )
}

import { XRPreviewEnvironment } from '@/components/xr/xr-preview-environment'

export default async function SceneXRPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <XRPreviewEnvironment sceneId={id} />
}

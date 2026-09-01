export function openXRPreview(path: string) {
  const preview = window.open(
    path,
    'pascal-xr-preview',
    'popup=yes,width=1280,height=800,resizable=yes,scrollbars=no',
  )
  preview?.focus()
}

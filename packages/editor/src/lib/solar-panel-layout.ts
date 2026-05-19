import type { RoofSegmentNode, SolarPanelNode } from '@pascal-app/core'

// Per-segment view of the slope the panel sits on, expressed in segment-local
// coordinates. Two-slope roofs (gable etc.) split into a +Z and -Z slope; the
// side is chosen by panelLocalZ. Other types collapse to "the whole segment
// depth is the slope" — enough for Auto-fit to do something reasonable.
function getSlopeDepthBounds(
  segment: RoofSegmentNode,
  panelLocalZ: number,
): { minZ: number; maxZ: number } {
  const halfD = segment.depth / 2
  switch (segment.roofType) {
    case 'gable':
    case 'gambrel':
    case 'dutch':
    case 'mansard':
    case 'hip':
      return panelLocalZ >= 0
        ? { minZ: 0, maxZ: halfD }
        : { minZ: -halfD, maxZ: 0 }
    case 'shed':
    case 'flat':
    default:
      return { minZ: -halfD, maxZ: halfD }
  }
}

// Returns rows/cols that fit the panel grid edge-to-edge on the slope, or
// null when nothing fits (e.g. the segment is smaller than a single panel +
// gap). Schema's hard cap of 20 is enforced silently.
export function computeAutoFit(
  segment: RoofSegmentNode,
  panel: SolarPanelNode,
): { rows: number; columns: number } | null {
  const { minZ, maxZ } = getSlopeDepthBounds(segment, panel.position[2] ?? 0)
  const usableW = segment.width
  const usableD = maxZ - minZ
  if (usableW <= 0 || usableD <= 0) return null

  // `cells = floor((usable + gap) / (size + gap))` because n panels with n-1
  // inter-panel gaps occupy n*size + (n-1)*gap = n(size+gap) - gap.
  const columns = Math.floor((usableW + panel.gapX) / (panel.panelWidth + panel.gapX))
  const rows = Math.floor((usableD + panel.gapY) / (panel.panelHeight + panel.gapY))
  if (columns < 1 || rows < 1) return null

  return {
    rows: Math.min(rows, 20),
    columns: Math.min(columns, 20),
  }
}

// Pure helper for the Flip button: swap width and height. Caller is
// responsible for clearing panelTypePreset (since this changes panel dims).
export function flippedPanelDims(panel: SolarPanelNode): {
  panelWidth: number
  panelHeight: number
} {
  return {
    panelWidth: panel.panelHeight,
    panelHeight: panel.panelWidth,
  }
}

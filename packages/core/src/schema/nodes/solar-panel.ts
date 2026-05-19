import dedent from 'dedent'
import { z } from 'zod'
import { SolarPanelPresetKey } from '../../solar-panel-presets'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SolarPanelMaterialRole = z.enum(['frame', 'panel'])
export type SolarPanelMaterialRole = z.infer<typeof SolarPanelMaterialRole>

export const SolarPanelNode = BaseNode.extend({
  id: objectId('solarpanel'),
  type: nodeType('solar-panel'),
  // Frame / rail material — aluminum mounting rails.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Panel surface material — dark photovoltaic glass.
  panelMaterial: MaterialSchema.optional(),
  panelMaterialPreset: z.string().optional(),

  // Visual preset that drove panelWidth/panelHeight/frameThickness/frameDepth.
  // Cleared to undefined whenever any of those four fields is edited manually,
  // so its presence always means "values match the preset table exactly".
  panelTypePreset: SolarPanelPresetKey.optional(),

  // Host: the RoofSegmentNode this solar panel array is attached to.
  roofSegmentId: z.string().optional(),

  // Segment-local position. x along segment width (u), z along segment depth (v),
  // y is the segment-local height captured from the raycast hit on the shingle
  // surface. If y is 0 (legacy panels), the renderer falls back to an analytical
  // bare-rafter height (which sinks the panel into the deck+shingles).
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw around the vertical axis.
  rotation: z.number().default(0),

  // Grid layout.
  rows: z.number().int().min(1).max(20).default(4),
  columns: z.number().int().min(1).max(20).default(5),

  // Individual panel dimensions (meters). Defaults match the 'residential' preset.
  panelWidth: z.number().default(1.0),
  panelHeight: z.number().default(1.65),

  // Gaps between panels.
  gapX: z.number().default(0.02),
  gapY: z.number().default(0.02),

  // Mounting type.
  mountingType: z.enum(['flush', 'tilted']).default('flush'),
  // Tilt angle in degrees relative to the roof surface (only used when tilted).
  tiltAngle: z.number().default(15),
  // Clearance between roof surface and panel bottom.
  standoffHeight: z.number().default(0.05),

  // Frame.
  frameThickness: z.number().default(0.04),
  frameDepth: z.number().default(0.04),

  // Surface normal at placement point (segment-local space).
  // Captured from raycast during move/placement; used to orient the panel
  // flat on the roof slope. Falls back to analytical computation if absent.
  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),
}).describe(
  dedent`
  Solar panel array node - a grid of photovoltaic panels hosted on a roof segment.
  - roofSegmentId: id of the host RoofSegmentNode
  - panelTypePreset: optional visual preset key; when set, panelWidth/Height/
    frameThickness/frameDepth equal the preset table values
  - position: segment-local coordinates ([u, surfaceY, v])
  - rotation: yaw around the vertical axis
  - rows/columns: grid layout of the panel array
  - panelWidth/panelHeight: dimensions of each individual panel
  - gapX/gapY: spacing between panels horizontally and vertically
  - mountingType: flush (flat on roof) or tilted (angled)
  - tiltAngle: degrees relative to roof surface (tilted mode only)
  - standoffHeight: clearance above roof surface
  - frameThickness: width of the aluminum frame border
  - frameDepth: total depth/thickness of panel + frame
  `,
)

export type SolarPanelNode = z.infer<typeof SolarPanelNode>

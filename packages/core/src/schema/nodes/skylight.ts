import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SkylightMaterialRole = z.enum(['frame', 'glass'])
export type SkylightMaterialRole = z.infer<typeof SkylightMaterialRole>

export const SkylightNode = BaseNode.extend({
  id: objectId('skylight'),
  type: nodeType('skylight'),
  // Frame material — used for the outer frame and curb.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Glass material — applied to the glass pane. Falls back to a default translucent material.
  glassMaterial: MaterialSchema.optional(),
  glassMaterialPreset: z.string().optional(),

  // Host: the RoofSegmentNode this skylight is attached to.
  roofSegmentId: z.string().optional(),

  // Segment-local 2D position: x along segment width (u), z along segment depth (v).
  // y is computed at render time from the segment's pitched surface.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw around the surface normal (rotation on the pitched plane).
  rotation: z.number().default(0),

  // Glass opening dimensions.
  width: z.number().default(0.8),
  height: z.number().default(1.0),

  // Frame profile.
  frameThickness: z.number().default(0.05),
  frameDepth: z.number().default(0.1),

  // Skylight style — fixed (sealed) or vented (shows a hinge line).
  skylightType: z.enum(['fixed', 'vented']).default('fixed'),

  // Raised curb around the frame for waterproofing.
  curb: z.boolean().default(true),
  curbHeight: z.number().default(0.1),

  // How far the roof cutout extends beyond the frame on each side.
  cutoutOffset: z.number().default(0.02),
}).describe(
  dedent`
  Skylight node - a framed glass opening hosted on a roof segment.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v]); y is ignored,
    placement is anchored to the segment's pitched surface
  - rotation: yaw on the pitched surface
  - width/height: glass opening dimensions
  - frameThickness: width of the frame profile around the glass
  - frameDepth: how deep the frame sits into the roof
  - skylightType: fixed (sealed) or vented (shows hinge line)
  - curb: whether to render a raised curb for waterproofing
  - curbHeight: height of the curb above the roof surface
  - cutoutOffset: extra margin on each side for the roof hole
  `,
)

export type SkylightNode = z.infer<typeof SkylightNode>

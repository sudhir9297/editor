import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SkylightMaterialRole = z.enum(['frame', 'glass'])
export type SkylightMaterialRole = z.infer<typeof SkylightMaterialRole>

export const SkylightNode = BaseNode.extend({
  id: objectId('skylight'),
  type: nodeType('skylight'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  glassMaterial: MaterialSchema.optional(),
  glassMaterialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  width: z.number().default(0.9),
  height: z.number().default(1.2),

  frameThickness: z.number().default(0.05),
  frameDepth: z.number().default(0.08),

  skylightType: z.enum(['fixed']).default('fixed'),

  curb: z.boolean().default(false),
  curbHeight: z.number().default(0.1),

  cutoutOffset: z.number().default(0.01),

  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),
}).describe(
  dedent`
  Skylight node — a framed glass opening hosted on a roof segment.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v]); y is ignored,
    placement is anchored to the segment's pitched surface
  - rotation: yaw on the pitched surface
  - width/height: glass opening dimensions
  - frameThickness: width of the frame profile around the glass
  - frameDepth: how deep the frame sits into the roof
  - skylightType: fixed (sealed); extensible to vented, tubular, dome
  - curb: whether to render a raised curb for waterproofing
  - curbHeight: height of the curb above the roof surface
  - cutoutOffset: extra margin on each side for the roof hole
  `,
)

export type SkylightNode = z.infer<typeof SkylightNode>

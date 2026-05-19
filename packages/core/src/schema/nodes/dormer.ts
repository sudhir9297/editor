import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { RoofType } from './roof-type'

export const DormerNode = BaseNode.extend({
  id: objectId('dormer'),
  type: nodeType('dormer'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),

  width: z.number().default(2.0),
  depth: z.number().default(1.5),
  height: z.number().default(1.2),

  roofType: RoofType.default('gable'),
  roofHeight: z.number().default(0.6),
}).describe(
  dedent`
  Dormer node — a small house-shaped protrusion sitting on top of a roof
  segment. Rendered with the same walls+roof geometry as a roof segment, just
  smaller. Does not cut the host roof.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v])
  - rotation: yaw on the segment surface
  - width / depth / height: footprint and wall height
  - roofType / roofHeight: dormer's own roof shape and pitch
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

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

  width: z.number().default(2.59),
  depth: z.number().default(5.0),
  height: z.number().default(0.2),

  roofType: RoofType.default('gable'),
  roofHeight: z.number().default(0.83),
}).describe(
  dedent`
  Dormer node — a small house-shaped protrusion sitting on top of a roof
  segment.
  - width / depth / height: footprint and wall height
  - roofType / roofHeight: dormer's own roof shape and pitch
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

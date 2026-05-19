import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

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
}).describe(
  dedent`
  Dormer node — a box-shaped placeholder protrusion sitting on top of a roof
  segment. Does not cut the host roof.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v])
  - rotation: yaw on the segment surface
  - width / depth / height: box dimensions
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

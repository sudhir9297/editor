import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RidgeVentNode = BaseNode.extend({
  id: objectId('rvent'),
  type: nodeType('ridge-vent'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  length: z.number().default(2.0),
  width: z.number().default(0.3),
  height: z.number().default(0.08),

  style: z.enum(['standard', 'shingled', 'metal']).default('standard'),
  endCaps: z.boolean().default(true),
}).describe(
  dedent`
  Ridge vent node — a ventilation strip that sits along the ridge (peak) of a
  roof segment.
  - length: how far the vent extends along the ridge
  - width: vent width straddling the ridge center
  - height: profile height above the ridge surface
  - style: visual profile — standard / shingled / metal
  - endCaps: whether to cap the vent at both ends
  `,
)

export type RidgeVentNode = z.infer<typeof RidgeVentNode>

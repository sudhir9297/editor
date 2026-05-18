import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ChimneyNode = BaseNode.extend({
  id: objectId('chimney'),
  type: nodeType('chimney'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),

  // Host: the RoofSegmentNode this chimney is attached to.
  // Stored as a plain string id (mirrors WindowNode.wallId) to avoid
  // a circular zod import with RoofSegmentNode.
  roofSegmentId: z.string().optional(),

  // Segment-local 2D position: x along segment width (u), z along segment depth (v).
  // y is computed at render time from the segment's pitched surface.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw around the vertical axis (chimneys stay world-vertical).
  rotation: z.number().default(0),

  // Footprint
  width: z.number().default(0.6),
  depth: z.number().default(0.6),
  // How far the chimney top sits above the host segment's ridge peak.
  heightAboveRidge: z.number().default(1.0),
}).describe(
  dedent`
  Chimney node - a vertical brick/stone chimney hosted on a roof segment.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v]); the y component is ignored,
    placement is anchored to the segment's pitched surface
  - rotation: yaw around the world-vertical axis
  - width/depth: chimney footprint in segment-local space
  - heightAboveRidge: chimney top height above the host segment's ridge peak
  `,
)

export type ChimneyNode = z.infer<typeof ChimneyNode>

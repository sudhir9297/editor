import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const DormerMaterialRole = z.enum(['wall', 'roof', 'frame', 'glass'])
export type DormerMaterialRole = z.infer<typeof DormerMaterialRole>

export const DormerNode = BaseNode.extend({
  id: objectId('dormer'),
  type: nodeType('dormer'),

  // Materials (4 surfaces)
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  roofMaterial: MaterialSchema.optional(),
  roofMaterialPreset: z.string().optional(),
  frameMaterial: MaterialSchema.optional(),
  frameMaterialPreset: z.string().optional(),
  glassMaterial: MaterialSchema.optional(),
  glassMaterialPreset: z.string().optional(),

  // Parent + placement (mirrors skylight)
  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  surfaceNormal: z.tuple([z.number(), z.number(), z.number()]).optional(),

  // Dormer structure
  width: z.number().default(2.0),
  depth: z.number().default(1.5),
  frontWallHeight: z.number().default(1.2),
  roofPitchDeg: z.number().default(35),
  wallThickness: z.number().default(0.15),
  roofThickness: z.number().default(0.08),
  roofOverhangFront: z.number().default(0.15),
  roofOverhangSides: z.number().default(0.1),

  // Window (built-in)
  hasWindow: z.boolean().default(true),
  windowWidth: z.number().default(1.2),
  windowHeight: z.number().default(0.9),
  windowSillHeight: z.number().default(0.3),
  windowFrameThickness: z.number().default(0.05),
  windowFrameDepth: z.number().default(0.08),

  // CSG inflate
  cutoutOffset: z.number().default(0.01),
}).describe(
  dedent`
  Dormer node — a structural protrusion from a roof segment with its own
  gable roof, walls, and built-in window. Cuts a large opening in the host
  roof segment beneath its footprint.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v]); y is ignored — placement
    is anchored to the segment's pitched surface at the dormer's front-center
  - rotation: yaw on the pitched surface (locked at 0 for v1)
  - width/depth/frontWallHeight: dormer footprint and wall height
  - roofPitchDeg: dormer roof pitch in degrees
  - hasWindow + window* fields: built-in front-facing window
  - cutoutOffset: extra margin around the roof hole
  `,
)

export type DormerNode = z.infer<typeof DormerNode>

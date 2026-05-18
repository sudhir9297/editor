import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ChimneyMaterialRole = z.enum(['surface', 'top'])
export type ChimneyMaterialRole = z.infer<typeof ChimneyMaterialRole>

export const ChimneyNode = BaseNode.extend({
  id: objectId('chimney'),
  type: nodeType('chimney'),
  // Main / body material — used by body, bands, flues, cricket.
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Top material — applied to the cap. Falls back to `material` if unset.
  topMaterial: MaterialSchema.optional(),
  topMaterialPreset: z.string().optional(),

  // Host: the RoofSegmentNode this chimney is attached to.
  // Stored as a plain string id (mirrors WindowNode.wallId) to avoid
  // a circular zod import with RoofSegmentNode.
  roofSegmentId: z.string().optional(),

  // Segment-local 2D position: x along segment width (u), z along segment depth (v).
  // y is computed at render time from the segment's pitched surface.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw around the vertical axis (chimneys stay world-vertical).
  rotation: z.number().default(0),

  // Body cross-section shape — square (box) or round (cylinder).
  bodyShape: z.enum(['square', 'round']).default('square'),
  // How deep the top cavity (smoke hole) is carved into the body.
  bodyHollowDepth: z.number().default(0.6),
  // Wall thickness around the top cavity — distance from the cavity wall to
  // the outer body face. 0 disables the cavity.
  bodyHollowMargin: z.number().default(0.08),
  // Footprint — for 'round', width is the diameter and depth is ignored.
  width: z.number().default(0.6),
  depth: z.number().default(0.6),
  // How far the chimney top sits above the host segment's ridge peak.
  heightAboveRidge: z.number().default(1.0),
  // How far the roof cutout extends beyond the chimney footprint on each side.
  // Larger values create a wider visible gap between the chimney and the roof.
  cutoutOffset: z.number().default(0),

  // ---- Cap ----
  // Concrete cap on top of the masonry stack; oversized to shed water.
  cap: z.boolean().default(true),
  // Cap shape style ('none' = no cap).
  capShape: z.enum(['none', 'sloped', 'flat', 'stepped']).default('sloped'),
  // Horizontal overhang of the cap beyond the chimney on each side.
  capOverhang: z.number().default(0.04),
  // Vertical thickness of the cap slab at its outer edge.
  capThickness: z.number().default(0.08),

  // ---- Flue liner(s) ----
  // Pipes poking out of the cap that vent flue gases.
  flueCount: z.number().int().min(0).max(4).default(1),
  flueShape: z.enum(['round', 'square']).default('round'),
  // Height of the flue above the cap's top surface.
  flueHeight: z.number().default(0.3),
  // Outer width (square) or diameter (round) of one flue.
  flueDiameter: z.number().default(0.22),
  // How spread out the flues are along the chimney width when count > 1:
  // 1 = filled edge-to-edge (current), 0 = all bunched at the center.
  flueSpacing: z.number().default(1),
  // Wall thickness of each flue (so each flue is a tube, not a solid). 0
  // makes the flues solid again.
  flueWallThickness: z.number().default(0.02),

  // ---- Shoulder ----
  // Flared/widened base where the chimney emerges from the roof.
  shoulderStyle: z.enum(['none', 'tapered', 'corbeled']).default('none'),
  // Vertical height of the shoulder section above the roof line.
  shoulderHeight: z.number().default(0.5),
  // Extra horizontal width at the BOTTOM of the shoulder on each side.
  shoulderExtent: z.number().default(0.1),

  // ---- Decorative bands ----
  // Horizontal stripes around the chimney (soldier-course brick / stone band).
  bandStyle: z.enum(['none', 'single', 'double']).default('none'),
  // Vertical thickness of one band.
  bandHeight: z.number().default(0.1),
  // How far the band protrudes from the chimney surface (per side).
  bandExtent: z.number().default(0.04),
  // Distance from the chimney top to the (lowest) band.
  bandOffset: z.number().default(0.4),

  // ---- Cricket ----
  // Small water-shedding wedge on the up-slope side of the chimney.
  cricketStyle: z.enum(['none', 'simple']).default('none'),
  // How far the cricket extends away from the chimney face (up the slope).
  cricketLength: z.number().default(0.6),
  // Peak height of the cricket against the chimney face.
  cricketHeight: z.number().default(0.4),
  // Which side of the chimney the cricket sits on.
  cricketSide: z.enum(['front', 'back']).default('front'),

  // ---- Inset panels / niches ----
  // Recessed rectangular panels on each face of the chimney body.
  panelStyle: z.enum(['none', 'rectangular']).default('none'),
  // Recess depth (how deep the panel is cut into the body).
  panelDepth: z.number().default(0.03),
  // Vertical height of the panel.
  panelHeight: z.number().default(0.8),
  // Distance from the chimney top to the top of the panel.
  panelOffsetTop: z.number().default(0.15),
  // Horizontal margin from each side of the chimney face to the panel edge.
  panelMargin: z.number().default(0.1),
}).describe(
  dedent`
  Chimney node - a vertical brick/stone chimney hosted on a roof segment.
  - roofSegmentId: id of the host RoofSegmentNode
  - position: segment-local coordinates ([u, _, v]); the y component is ignored,
    placement is anchored to the segment's pitched surface
  - rotation: yaw around the world-vertical axis
  - width/depth: chimney footprint in segment-local space
  - heightAboveRidge: chimney top height above the host segment's ridge peak
  - cutoutOffset: extra width on each side of the chimney for the roof hole
  - cap: whether to render the concrete cap on top
  - capShape: cap profile — none / sloped / flat / stepped
  - capOverhang: horizontal overhang of the cap beyond the chimney
  - capThickness: vertical thickness of the cap slab at its outer edge
  - flueCount: number of flue liner pipes protruding through the cap (0-4)
  - flueShape: round (clay) or square (terracotta) flue cross-section
  - flueHeight: how far the flues stick up above the cap
  - flueDiameter: outer width / diameter of each flue
  - flueSpacing: spread factor for multiple flues (0 = bunched, 1 = full width)
  - shoulderStyle: flared base — none / smooth taper / stepped corbel
  - shoulderHeight: vertical height of the flared section above the roof
  - shoulderExtent: extra width on each side at the bottom of the shoulder
  - bandStyle: decorative horizontal bands — none / single / double
  - bandHeight: vertical thickness of each band
  - bandExtent: how far each band protrudes from the chimney
  - bandOffset: distance from the chimney top to the (top-most) band
  - cricketStyle: water-diverting wedge on the up-slope chimney face — none / simple
  - cricketLength: how far it extends out from the chimney
  - cricketHeight: peak height at the chimney face
  - cricketSide: which face the cricket attaches to — front / back
  - panelStyle: recessed panels on chimney faces — none / rectangular
  - panelDepth: recess depth into the body
  - panelHeight: vertical height of the panel
  - panelOffsetTop: distance from chimney top to top of panel
  - panelMargin: horizontal margin from face edges to panel edges
  `,
)

export type ChimneyNode = z.infer<typeof ChimneyNode>

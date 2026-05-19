import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SkylightMaterialRole = z.enum(['frame', 'glass'])
export type SkylightMaterialRole = z.infer<typeof SkylightMaterialRole>

export const SKYLIGHT_TYPE_ORDER = ['flat', 'walk-on', 'lantern', 'opening', 'sliding'] as const

export const SkylightType = z.enum(SKYLIGHT_TYPE_ORDER)
export type SkylightType = (typeof SKYLIGHT_TYPE_ORDER)[number]

export const SkylightOpeningSide = z.enum(['top', 'bottom', 'left', 'right'])
export type SkylightOpeningSide = z.infer<typeof SkylightOpeningSide>

export const SkylightSlideDirection = z.enum(['x', 'z'])
export type SkylightSlideDirection = z.infer<typeof SkylightSlideDirection>

export type SkylightTypePreset = {
  label: string
  width: number
  height: number
  frameThickness: number
  frameDepth: number
  glassThickness: number
  curb: boolean
  curbHeight: number
  cutoutOffset: number
  lanternHeight: number
  lanternTopScale: number
  openingAngle: number
  openingSide: SkylightOpeningSide
  operationState: number
  motorHousing: boolean
  slideFraction: number
  slideDirection: SkylightSlideDirection
  trackWidth: number
  motorHousingSize: number
}

export const SKYLIGHT_TYPE_PRESETS = {
  flat: {
    label: 'Flat roof skylight',
    width: 0.9,
    height: 1.2,
    frameThickness: 0.055,
    frameDepth: 0.08,
    glassThickness: 0.012,
    curb: true,
    curbHeight: 0.08,
    cutoutOffset: 0,
    lanternHeight: 0.25,
    lanternTopScale: 0,
    openingAngle: 0,
    openingSide: 'top',
    operationState: 0,
    motorHousing: false,
    slideFraction: 0,
    slideDirection: 'z',
    trackWidth: 0.04,
    motorHousingSize: 0.08,
  },
  'walk-on': {
    label: 'Walk-on rooflight',
    width: 1.2,
    height: 1.8,
    frameThickness: 0.035,
    frameDepth: 0.045,
    glassThickness: 0.04,
    curb: false,
    curbHeight: 0,
    cutoutOffset: 0,
    lanternHeight: 0.25,
    lanternTopScale: 0,
    openingAngle: 0,
    openingSide: 'top',
    operationState: 0,
    motorHousing: false,
    slideFraction: 0,
    slideDirection: 'z',
    trackWidth: 0.04,
    motorHousingSize: 0.08,
  },
  lantern: {
    label: 'Roof lantern',
    width: 1.4,
    height: 1.4,
    frameThickness: 0.06,
    frameDepth: 0.08,
    glassThickness: 0.012,
    curb: true,
    curbHeight: 0.16,
    cutoutOffset: 0,
    lanternHeight: 0.45,
    lanternTopScale: 0,
    openingAngle: 0,
    openingSide: 'top',
    operationState: 0,
    motorHousing: false,
    slideFraction: 0,
    slideDirection: 'z',
    trackWidth: 0.04,
    motorHousingSize: 0.08,
  },
  opening: {
    label: 'Opening skylight',
    width: 0.9,
    height: 1.2,
    frameThickness: 0.06,
    frameDepth: 0.035,
    glassThickness: 0.014,
    curb: true,
    curbHeight: 0.1,
    cutoutOffset: 0,
    lanternHeight: 0.25,
    lanternTopScale: 0,
    openingAngle: Math.PI / 8,
    openingSide: 'top',
    operationState: 1,
    motorHousing: false,
    slideFraction: 0,
    slideDirection: 'z',
    trackWidth: 0.04,
    motorHousingSize: 0.08,
  },
  sliding: {
    label: 'Sliding skylight',
    width: 1.4,
    height: 1.1,
    frameThickness: 0.055,
    frameDepth: 0.08,
    glassThickness: 0.012,
    curb: true,
    curbHeight: 0.08,
    cutoutOffset: 0,
    lanternHeight: 0.25,
    lanternTopScale: 0,
    openingAngle: 0,
    openingSide: 'top',
    operationState: 0.35,
    motorHousing: false,
    slideFraction: 0.35,
    slideDirection: 'x',
    trackWidth: 0.045,
    motorHousingSize: 0.08,
  },
} as const satisfies Record<SkylightType, SkylightTypePreset>

const DEFAULT_SKYLIGHT_PRESET = SKYLIGHT_TYPE_PRESETS.flat

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

  width: z.number().default(DEFAULT_SKYLIGHT_PRESET.width),
  height: z.number().default(DEFAULT_SKYLIGHT_PRESET.height),

  frameThickness: z.number().default(DEFAULT_SKYLIGHT_PRESET.frameThickness),
  frameDepth: z.number().default(DEFAULT_SKYLIGHT_PRESET.frameDepth),

  skylightType: SkylightType.default('flat'),

  glassThickness: z.number().default(DEFAULT_SKYLIGHT_PRESET.glassThickness),

  lanternHeight: z.number().default(DEFAULT_SKYLIGHT_PRESET.lanternHeight),
  lanternTopScale: z.number().default(DEFAULT_SKYLIGHT_PRESET.lanternTopScale),

  openingAngle: z.number().default(DEFAULT_SKYLIGHT_PRESET.openingAngle),
  openingSide: SkylightOpeningSide.default(DEFAULT_SKYLIGHT_PRESET.openingSide),
  operationState: z.number().min(0).max(1).default(DEFAULT_SKYLIGHT_PRESET.operationState),
  motorHousing: z.boolean().default(DEFAULT_SKYLIGHT_PRESET.motorHousing),

  slideFraction: z.number().min(0).max(1).default(DEFAULT_SKYLIGHT_PRESET.slideFraction),
  slideDirection: SkylightSlideDirection.default(DEFAULT_SKYLIGHT_PRESET.slideDirection),
  trackWidth: z.number().default(DEFAULT_SKYLIGHT_PRESET.trackWidth),
  motorHousingSize: z.number().default(DEFAULT_SKYLIGHT_PRESET.motorHousingSize),

  curb: z.boolean().default(DEFAULT_SKYLIGHT_PRESET.curb),
  curbHeight: z.number().default(DEFAULT_SKYLIGHT_PRESET.curbHeight),

  cutoutOffset: z.number().default(DEFAULT_SKYLIGHT_PRESET.cutoutOffset),

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
  - skylightType: flat, walk-on, lantern, opening, sliding
  - glassThickness: visual glass thickness
  - lanternHeight/lanternTopScale: roof lantern proportions
  - openingAngle/openingSide/operationState/motorHousing/motorHousingSize: opening skylight behavior
  - operationState/slideDirection/trackWidth: sliding skylight behavior
  - curb: whether to render a raised curb for waterproofing
  - curbHeight: height of the curb above the roof surface
  - cutoutOffset: extra margin on each side for the roof hole
  `,
)

export type SkylightNode = z.infer<typeof SkylightNode>

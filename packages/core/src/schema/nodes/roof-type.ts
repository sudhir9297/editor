import { z } from 'zod'

export const RoofType = z.enum(['hip', 'gable', 'shed', 'gambrel', 'dutch', 'mansard', 'flat'])

export type RoofType = z.infer<typeof RoofType>

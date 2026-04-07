import { z } from 'zod'

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1),
})

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

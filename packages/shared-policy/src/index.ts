import { z } from 'zod'

export const PolicyDecisionSchema = z.enum(['allow', 'confirm', 'deny'])

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>

export const PolicyEvaluationSchema = z.object({
  decision: PolicyDecisionSchema,
  reasons: z.array(z.string().min(1)).default([]),
  approvalRequired: z.boolean(),
  maxRiskLevel: z.enum(['low', 'medium', 'high']),
})

export type PolicyEvaluation = z.infer<typeof PolicyEvaluationSchema>

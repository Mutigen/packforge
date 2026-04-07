import { z } from 'zod'
import { ExecutionTarget, ProjectContextSchema } from './context.js'

export const RecommendationSchema = z.object({
  packId: z.string().min(1),
  version: z.string().min(1),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().min(1)).default([]),
  required: z.boolean().default(false),
})

export const PolicyDecisionSchema = z.enum(['allow', 'confirm', 'deny'])

export const ActivationPlanSchema = z.object({
  projectId: z.string().min(1),
  contextSnapshotId: z.string().min(1),
  executionTarget: z.enum(ExecutionTarget),
  context: ProjectContextSchema,
  recommendedPacks: z.array(RecommendationSchema),
  blockedPacks: z
    .array(
      z.object({
        packId: z.string().min(1),
        reasons: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  policyDecision: PolicyDecisionSchema,
  policyReasons: z.array(z.string().min(1)).default([]),
})

export const RuntimeInstructionSchema = z.object({
  packId: z.string().min(1),
  version: z.string().min(1),
  systemPrompt: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  toolsAllowed: z.array(z.string().min(1)).default([]),
  toolsBlocked: z.array(z.string().min(1)).default([]),
})

export const BootstrapStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  condition: z.enum(['always', 'if_missing_gitnexus', 'if_missing_deps', 'if_mempalace_available']),
  description: z.string().min(1).optional(),
})

export const RuntimeHandoffContractSchema = z.object({
  contractVersion: z.literal('1.0.0'),
  activationId: z.string().min(1),
  projectId: z.string().min(1),
  executionTarget: z.enum(ExecutionTarget),
  workspace: z.object({
    rootPath: z.string().min(1).optional(),
    sandboxId: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
  }),
  bootstrap: z.array(BootstrapStepSchema).default([]),
  instructions: z.array(RuntimeInstructionSchema).min(1),
  policy: z.object({
    approvalRequired: z.boolean(),
    maxRiskLevel: z.enum(['low', 'medium', 'high']),
    writeAccess: z.boolean(),
    networkAccess: z.boolean(),
    deployAllowed: z.boolean(),
  }),
  trace: z.object({
    contextSnapshotId: z.string().min(1),
    compilerRunId: z.string().min(1).optional(),
    generatedAt: z.string().min(1),
  }),
})

export type Recommendation = z.infer<typeof RecommendationSchema>
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>
export type ActivationPlan = z.infer<typeof ActivationPlanSchema>
export type RuntimeInstruction = z.infer<typeof RuntimeInstructionSchema>
export type BootstrapStep = z.infer<typeof BootstrapStepSchema>
export type RuntimeHandoffContract = z.infer<typeof RuntimeHandoffContractSchema>

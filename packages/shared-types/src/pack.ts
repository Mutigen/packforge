import { z } from 'zod'
import { Domain, Phase, RiskProfile, StackSignal, TaskType } from './taxonomy.js'

export const PackCategory = ['engineering', 'quality', 'product', 'documentation', 'ops'] as const
export type PackCategory = (typeof PackCategory)[number]

export const PackRiskLevel = ['low', 'medium', 'high'] as const
export type PackRiskLevel = (typeof PackRiskLevel)[number]

export const PackApprovalState = ['draft', 'review', 'approved'] as const
export type PackApprovalState = (typeof PackApprovalState)[number]

export const PackMaturityLevel = ['draft', 'stable', 'experimental'] as const
export type PackMaturityLevel = (typeof PackMaturityLevel)[number]

export const PersonalityTone = ['precise', 'direct', 'analytical', 'pragmatic', 'collaborative'] as const
export type PersonalityTone = (typeof PersonalityTone)[number]

export const PersonalityReasoningStyle = [
  'trade-off-first',
  'root-cause-first',
  'spec-first',
  'risk-first',
  'user-outcome-first',
] as const
export type PersonalityReasoningStyle = (typeof PersonalityReasoningStyle)[number]

export const PersonalityOutputFormat = ['structured', 'concise', 'checklist', 'report'] as const
export type PersonalityOutputFormat = (typeof PersonalityOutputFormat)[number]

export const ActivationSignalsSchema = z.object({
  keywords: z.array(z.string().min(1)).default([]),
  stack_hints: z.array(z.enum(StackSignal)).default([]),
  task_types: z.array(z.enum(TaskType)).default([]),
  domains: z.array(z.enum(Domain)).default([]),
  phases: z.array(z.enum(Phase)).default([]),
  risk_profiles: z.array(z.enum(RiskProfile)).default([]).optional(),
})

export const PersonalitySchema = z.object({
  tone: z.enum(PersonalityTone),
  reasoning_style: z.enum(PersonalityReasoningStyle),
  output_format: z.enum(PersonalityOutputFormat),
})

export const InstructionsSchema = z.object({
  system_prompt: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  tools_allowed: z.array(z.string().min(1)).default([]),
  tools_blocked: z.array(z.string().min(1)).default([]),
})

export const PackSectionsSchema = z
  .object({
    when_to_use: z.string().min(1).describe('Describes when this pack should be activated and for what scenarios'),
    constraints: z.array(z.string().min(1)).describe('Hard rules the agent must follow when this pack is active'),
    examples: z.array(z.string().min(1)).describe('Concrete usage examples showing the pack in action'),
    anti_patterns: z.array(z.string().min(1)).default([]).describe('Common mistakes to avoid'),
  })
  .optional()

export const PackProvenanceSchema = z.object({
  source_system: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  compiled_at: z.string().min(1),
  compiler_version: z.string().min(1),
})

export const PackApprovalSchema = z.object({
  state: z.enum(PackApprovalState),
  approved_by: z.string().min(1).optional(),
  approved_at: z.string().min(1).optional(),
})

export const PackMaturitySchema = z.object({
  level: z.enum(PackMaturityLevel),
})

export const PackExecutionPolicySchema = z.object({
  allowed_targets: z
    .array(z.enum(['client_workspace', 'sandbox_container', 'remote_runner']))
    .default(['client_workspace']),
  requires_human_confirm: z.boolean().default(true),
})

export const InstructionPackSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/, 'Pack id must be kebab-case'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  name: z.string().min(3),
  description: z.string().min(10),
  category: z.enum(PackCategory),
  domain: z.array(z.enum(Domain)).default([]),
  phase: z.array(z.enum(Phase)).default([]),
  risk_level: z.enum(PackRiskLevel),
  personality: PersonalitySchema,
  instructions: InstructionsSchema,
  sections: PackSectionsSchema,
  activation_signals: ActivationSignalsSchema,
  conflicts_with: z.array(z.string().min(1)).default([]),
  /**
   * Pack IDs that work well together.  Currently metadata-only — not used in
   * scoring.  Validated for symmetry by validatePackCollection.
   */
  compatible_with: z.array(z.string().min(1)).default([]),
  provenance: PackProvenanceSchema.optional(),
  approval: PackApprovalSchema.default({ state: 'approved' }),
  maturity: PackMaturitySchema.default({ level: 'stable' }),
  execution_policy: PackExecutionPolicySchema.default({
    allowed_targets: ['client_workspace'],
    requires_human_confirm: true,
  }),
})

export const PackRegistryEntrySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  category: z.enum(PackCategory),
  riskLevel: z.enum(PackRiskLevel),
  maturity: z.enum(PackMaturityLevel),
  approvalState: z.enum(PackApprovalState),
  filePath: z.string().min(1),
  description: z.string().min(1),
})

export type ActivationSignals = z.infer<typeof ActivationSignalsSchema>
export type Personality = z.infer<typeof PersonalitySchema>
export type Instructions = z.infer<typeof InstructionsSchema>
export type PackSections = z.infer<typeof PackSectionsSchema>
export type PackProvenance = z.infer<typeof PackProvenanceSchema>
export type PackApproval = z.infer<typeof PackApprovalSchema>
export type PackMaturity = z.infer<typeof PackMaturitySchema>
export type PackExecutionPolicy = z.infer<typeof PackExecutionPolicySchema>
export type InstructionPack = z.infer<typeof InstructionPackSchema>
export type PackRegistryEntry = z.infer<typeof PackRegistryEntrySchema>

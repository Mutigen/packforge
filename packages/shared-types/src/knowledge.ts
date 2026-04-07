import { z } from 'zod'
import { Domain, Phase, RiskProfile, StackSignal, TaskType } from './taxonomy.js'
import {
  PackCategory,
  PackRiskLevel,
  PersonalityOutputFormat,
  PersonalityReasoningStyle,
  PersonalityTone,
} from './pack.js'

export const ObsidianNoteKind = [
  'source',
  'concept',
  'domain',
  'pattern',
  'policy',
  'pack-blueprint',
  'taxonomy',
  'decision',
] as const
export type ObsidianNoteKind = (typeof ObsidianNoteKind)[number]

export const ObsidianNoteRefSchema = z.object({
  vault: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(ObsidianNoteKind),
})

export const PackBlueprintSchema = z.object({
  blueprintId: z.string().min(1),
  name: z.string().min(1),
  targetPackId: z.string().min(1),
  category: z.enum(PackCategory),
  description: z.string().min(1),
  domain: z.array(z.enum(Domain)).default([]),
  phase: z.array(z.enum(Phase)).default([]),
  riskLevel: z.enum(PackRiskLevel),
  sourceNotes: z.array(ObsidianNoteRefSchema).default([]),
  stackHints: z.array(z.enum(StackSignal)).default([]),
  taskTypes: z.array(z.enum(TaskType)).default([]),
  riskProfiles: z.array(z.enum(RiskProfile)).default([]),
  keywords: z.array(z.string().min(1)).default([]),
  compatibleWith: z.array(z.string().min(1)).default([]),
  conflictsWith: z.array(z.string().min(1)).default([]),
  tone: z.enum(PersonalityTone),
  reasoningStyle: z.enum(PersonalityReasoningStyle),
  outputFormat: z.enum(PersonalityOutputFormat),
  systemPrompt: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  toolsAllowed: z.array(z.string().min(1)).default([]),
  toolsBlocked: z.array(z.string().min(1)).default([]),
  status: z.enum(['draft', 'review', 'approved']).default('draft'),
})

export const CompilerWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  notePath: z.string().min(1).optional(),
})

export const CompilerRunReportSchema = z.object({
  runId: z.string().min(1),
  vaultPath: z.string().min(1),
  outputPath: z.string().min(1),
  compiledPackIds: z.array(z.string().min(1)).default([]),
  warnings: z.array(CompilerWarningSchema).default([]),
})

export type ObsidianNoteRef = z.infer<typeof ObsidianNoteRefSchema>
export type PackBlueprint = z.infer<typeof PackBlueprintSchema>
export type CompilerWarning = z.infer<typeof CompilerWarningSchema>
export type CompilerRunReport = z.infer<typeof CompilerRunReportSchema>

import { z } from 'zod'
import { Domain, Phase, RiskProfile, StackSignal, TaskType, WorkMode } from './taxonomy.js'

export const AnalyzerMode = ['full', 'fallback', 'manual'] as const
export type AnalyzerMode = (typeof AnalyzerMode)[number]

export const AnalyzerSource = [
  'gitnexus-meta',
  'gitnexus-query',
  'gitnexus-graph',
  'package-json',
  'requirements-txt',
  'pyproject-toml',
  'dockerfile',
  'docker-compose',
  'github-workflows',
  'readme-keywords',
  'filetree-heuristic',
  'user-form',
  'mempalace-identity',
  'mempalace-palace',
] as const
export type AnalyzerSource = (typeof AnalyzerSource)[number]

export const ExecutionTarget = ['client_workspace', 'sandbox_container', 'remote_runner'] as const
export type ExecutionTarget = (typeof ExecutionTarget)[number]

export const MODE_CONFIDENCE_FACTOR: Record<AnalyzerMode, number> = {
  full: 1,
  fallback: 0.75,
  manual: 0.65,
}

export const ProjectContextSchema = z.object({
  projectId: z.string().min(1),
  description: z.string().default(''),
  stack: z.array(z.enum(StackSignal)).default([]),
  phase: z.enum(Phase),
  domain: z.enum(Domain),
  taskType: z.enum(TaskType),
  riskProfile: z.enum(RiskProfile),
  workMode: z.enum(WorkMode).optional(),
  customKeywords: z.array(z.string().min(1)).default([]),
  analyzerMode: z.enum(AnalyzerMode),
  analyzerSources: z.array(z.enum(AnalyzerSource)).min(1),
  confidenceFactor: z.number().min(0).max(1),
  analyzedAt: z.string().min(1),
  executionTarget: z.enum(ExecutionTarget),
  repositoryPath: z.string().min(1).optional(),
  obsidianVaultPath: z.string().min(1).optional(),
  gitNexusRepo: z.string().min(1).optional(),
  gitNexusStaleDays: z.number().int().min(0).optional(),
  hasGitNexusIndex: z.boolean().default(false),
  gitNexusSymbolCount: z.number().int().min(0).optional(),
  gitNexusClusters: z.array(z.string().min(1)).default([]),
  hasMemPalace: z.boolean().default(false),
  mempalaceIdentity: z.string().optional(),
  mempalaceWingCount: z.number().int().min(0).optional(),
})

export const AnalyzeProjectInputSchema = z.object({
  projectId: z.string().min(1),
  repositoryPath: z.string().min(1).optional(),
  obsidianVaultPath: z.string().min(1).optional(),
  description: z.string().default(''),
  executionTarget: z.enum(ExecutionTarget).default('client_workspace'),
  taskType: z.enum(TaskType).optional(),
  domain: z.enum(Domain).optional(),
  phase: z.enum(Phase).optional(),
  riskProfile: z.enum(RiskProfile).optional(),
  workMode: z.enum(WorkMode).optional(),
  customKeywords: z.array(z.string().min(1)).default([]),
})

export type ProjectContext = z.infer<typeof ProjectContextSchema>
export type AnalyzeProjectInput = z.infer<typeof AnalyzeProjectInputSchema>

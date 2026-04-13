import { z } from 'zod'
import { ExecutionTarget, ProjectContextSchema, type AnalyzerMode, type ProjectContext } from './context.js'
import type { InstructionPack } from './pack.js'

// ---------------------------------------------------------------------------
// PackDiagnostic — structured diagnostics with severity + tags (biome-inspired)
// ---------------------------------------------------------------------------

export const DiagnosticSeverity = ['error', 'warning', 'info', 'hint'] as const
export type DiagnosticSeverity = (typeof DiagnosticSeverity)[number]

export const DiagnosticTag = [
  'conflict',
  'deprecated',
  'policy-violation',
  'low-confidence',
  'missing-tool',
  'score-penalty',
  'validation',
] as const
export type DiagnosticTag = (typeof DiagnosticTag)[number]

export const PackDiagnosticSchema = z.object({
  severity: z.enum(DiagnosticSeverity),
  tag: z.enum(DiagnosticTag),
  packId: z.string().min(1),
  message: z.string().min(1),
  suggestion: z.string().optional(),
})

export type PackDiagnostic = z.infer<typeof PackDiagnosticSchema>

// ---------------------------------------------------------------------------
// PackScorer — composable function-type (ni-inspired)
// ---------------------------------------------------------------------------

export type PackScorer = (
  pack: InstructionPack,
  context: ProjectContext,
  feedbackScores?: Record<string, number>,
) => number

// ---------------------------------------------------------------------------
// ActivationContext — central state object flowing through the pipeline (unbuild/zx-inspired)
// ---------------------------------------------------------------------------

export type ActivationContext = {
  activationId: string
  traceId: string
  projectContext: ProjectContext
  options: {
    minimumScore: number
    autoApprove: boolean
    failOnWarn: boolean
  }
  diagnostics: PackDiagnostic[]
  timings: Map<string, number>
  aborted: boolean
}

// ---------------------------------------------------------------------------
// ActivationResult — exhaustive result type with boolean flags (execa-inspired)
// ---------------------------------------------------------------------------

export const ActivationResultSchema = z.object({
  activationId: z.string().min(1),
  traceId: z.string().min(1),

  // Core result (lazy-referenced — schemas defined below)
  plan: z.lazy(() => ActivationPlanSchema).optional(),
  handoff: z.lazy(() => RuntimeHandoffContractSchema).optional(),

  // Diagnostic flags
  failed: z.boolean(),
  timedOut: z.boolean(),
  isCanceled: z.boolean(),
  isPolicyBlocked: z.boolean(),
  isLowConfidence: z.boolean(),

  // Metrics
  durationMs: z.number().min(0),
  scoringDurationMs: z.number().min(0).optional(),
  policyDurationMs: z.number().min(0).optional(),

  // Context
  analyzerMode: z.enum(['full', 'fallback', 'manual']),

  // Structured diagnostics
  diagnostics: z.array(PackDiagnosticSchema).default([]),
})

// ---------------------------------------------------------------------------
// CancellationTokens — abort vs cancel (moon-inspired)
// ---------------------------------------------------------------------------

export type CancellationTokens = {
  /** Hard abort — error condition, stop immediately */
  abort: AbortController
  /** Soft cancel — user signal, graceful shutdown */
  cancel: AbortController
}

export function createCancellationTokens(): CancellationTokens {
  return {
    abort: new AbortController(),
    cancel: new AbortController(),
  }
}

// ---------------------------------------------------------------------------
// Lifecycle Hooks — typed hook system (oclif + unbuild inspired)
// ---------------------------------------------------------------------------

export type OrchestratorHooks = {
  'context:analyzed': (ctx: ActivationContext) => Promise<void> | void
  'scoring:complete': (ctx: ActivationContext, results: Recommendation[]) => Promise<void> | void
  'policy:evaluated': (ctx: ActivationContext, diagnostics: PackDiagnostic[]) => Promise<void> | void
  'activation:before': (ctx: ActivationContext, plan: ActivationPlan) => Promise<void> | void
  'activation:after': (ctx: ActivationContext, result: ActivationResult) => Promise<void> | void
  'activation:error': (ctx: ActivationContext, error: Error) => Promise<void> | void
}

// Forward-reference: ActivationResult type is defined after schemas
// (ActivationPlanSchema is needed for the schema, schema needed for type)

// ---------------------------------------------------------------------------
// Event Subscriber — decoupled event architecture (moon-inspired)
// ---------------------------------------------------------------------------

export type ActivationEvent =
  | { type: 'context:analyzed'; ctx: ActivationContext }
  | { type: 'scoring:complete'; ctx: ActivationContext; recommendations: Recommendation[] }
  | { type: 'policy:evaluated'; ctx: ActivationContext; diagnostics: PackDiagnostic[] }
  | { type: 'activation:complete'; ctx: ActivationContext; result: ActivationResult }
  | { type: 'activation:error'; ctx: ActivationContext; error: Error }

export interface ActivationSubscriber {
  onEvent(event: ActivationEvent): void | Promise<void>
}

// ---------------------------------------------------------------------------
// Original schemas (kept — backward compatible)
// ---------------------------------------------------------------------------

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
  condition: z.enum([
    'always',
    'if_missing_gitnexus',
    'if_missing_deps',
    'if_mempalace_available',
    'if_project_not_indexed',
  ]),
  description: z.string().min(1).optional(),
})

export const PendingPackSchema = z.object({
  packId: z.string().min(1),
  version: z.string().min(1),
  reason: z.string().min(1),
  requiredTool: z.enum(['gitnexus', 'mempalace']),
  instruction: RuntimeInstructionSchema,
})

export const MissingToolSchema = z.object({
  tool: z.enum(['gitnexus', 'mempalace', 'obsidian']),
  label: z.string().min(1),
  description: z.string().min(1),
  installGuide: z.string().min(1),
  benefits: z.array(z.string().min(1)).default([]),
  impactedPacks: z.array(z.string().min(1)).default([]),
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
  /**
   * Active runtime instructions.  May be empty when all recommended packs are
   * in `pendingPacks` (awaiting external tool installation).
   */
  instructions: z.array(RuntimeInstructionSchema).default([]),
  pendingPacks: z.array(PendingPackSchema).default([]),
  missingTools: z.array(MissingToolSchema).default([]),
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
export type PendingPack = z.infer<typeof PendingPackSchema>
export type MissingTool = z.infer<typeof MissingToolSchema>
export type RuntimeHandoffContract = z.infer<typeof RuntimeHandoffContractSchema>
export type ActivationResult = z.infer<typeof ActivationResultSchema>

// ---------------------------------------------------------------------------
// ActivationResult factories — success / error duality (execa-inspired)
// ---------------------------------------------------------------------------

export function makeActivationSuccess(params: {
  activationId: string
  traceId: string
  plan: ActivationPlan
  handoff?: RuntimeHandoffContract
  analyzerMode: AnalyzerMode
  diagnostics?: PackDiagnostic[]
  durationMs: number
  scoringDurationMs?: number
  policyDurationMs?: number
}): ActivationResult {
  return {
    activationId: params.activationId,
    traceId: params.traceId,
    plan: params.plan,
    handoff: params.handoff,
    failed: false,
    timedOut: false,
    isCanceled: false,
    isPolicyBlocked: false,
    isLowConfidence: params.plan.context.analyzerMode !== 'full',
    durationMs: params.durationMs,
    scoringDurationMs: params.scoringDurationMs,
    policyDurationMs: params.policyDurationMs,
    analyzerMode: params.analyzerMode,
    diagnostics: params.diagnostics ?? [],
  }
}

export function makeActivationError(params: {
  activationId: string
  traceId: string
  reason: 'policy' | 'timeout' | 'cancel' | 'error'
  analyzerMode: AnalyzerMode
  diagnostics?: PackDiagnostic[]
  durationMs: number
}): ActivationResult {
  return {
    activationId: params.activationId,
    traceId: params.traceId,
    failed: true,
    timedOut: params.reason === 'timeout',
    isCanceled: params.reason === 'cancel',
    isPolicyBlocked: params.reason === 'policy',
    isLowConfidence: false,
    durationMs: params.durationMs,
    analyzerMode: params.analyzerMode,
    diagnostics: params.diagnostics ?? [],
  }
}

// ---------------------------------------------------------------------------
// Hook Runner — manages typed lifecycle hooks
// ---------------------------------------------------------------------------

export class HookRunner {
  private hooks = new Map<string, Array<(...args: unknown[]) => unknown>>()

  on<K extends keyof OrchestratorHooks>(event: K, fn: OrchestratorHooks[K]): void {
    const list = this.hooks.get(event) ?? []
    list.push(fn as (...args: unknown[]) => unknown)
    this.hooks.set(event, list)
  }

  async emit<K extends keyof OrchestratorHooks>(event: K, ...args: Parameters<OrchestratorHooks[K]>): Promise<void> {
    for (const fn of this.hooks.get(event) ?? []) {
      try {
        await fn(...args)
      } catch (err) {
        console.error(`[HookRunner] hook "${event}" threw:`, err)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event Emitter — manages subscribers (moon-inspired)
// ---------------------------------------------------------------------------

export class ActivationEventEmitter {
  private subscribers: ActivationSubscriber[] = []

  subscribe(subscriber: ActivationSubscriber): void {
    this.subscribers.push(subscriber)
  }

  async emit(event: ActivationEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber.onEvent(event)
      } catch (err) {
        console.error(`[ActivationEventEmitter] subscriber threw on "${event.type}":`, err)
      }
    }
  }
}

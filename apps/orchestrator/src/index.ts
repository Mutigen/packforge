import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { validatePackDirectory } from '@hub/pack-validator'
import type {
  ActivationContext,
  ActivationPlan,
  ActivationResult,
  CancellationTokens,
  InstructionPack,
  PackScorer,
  ProjectContext,
  Recommendation,
} from '@hub/shared-types'
import { ActivationEventEmitter, HookRunner, makeActivationError, makeActivationSuccess } from '@hub/shared-types'
import { defaultScorer } from './matcher.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockedPack = {
  packId: string
  reasons: string[]
}

type OrchestratorOptions = {
  packsDir?: string
  scorer?: PackScorer
  hooks?: HookRunner
  subscribers?: ActivationEventEmitter
}

/** Score threshold above which a pack is marked `required`. */
const BASE_REQUIRED_THRESHOLD = 80

/** Maximum convergence iterations to prevent infinite loops. */
const MAX_CONVERGENCE_ITERATIONS = 10

// ---------------------------------------------------------------------------
// Content-hash cache (replaces TTL-based cache)
// ---------------------------------------------------------------------------

async function computeDirectoryHash(dir: string): Promise<string> {
  const hash = createHash('sha256')
  try {
    const entries = await readdir(dir, { recursive: true })
    const yamlFiles = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml')).sort()
    for (const file of yamlFiles) {
      const content = await readFile(path.join(dir, file), 'utf-8')
      hash.update(file)
      hash.update(content)
    }
  } catch {
    hash.update('empty')
  }
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReasons(pack: InstructionPack, ctx: ProjectContext): string[] {
  const reasons: string[] = []
  const stackMatches = ctx.stack.filter((signal) => pack.activation_signals.stack_hints.includes(signal))
  if (stackMatches.length > 0) {
    reasons.push(`stack match: ${stackMatches.join(', ')}`)
  }
  if (pack.activation_signals.phases.includes(ctx.phase)) {
    reasons.push(`phase match: ${ctx.phase}`)
  }
  if (pack.activation_signals.domains.includes(ctx.domain)) {
    reasons.push(`domain match: ${ctx.domain}`)
  }
  if (pack.activation_signals.task_types.includes(ctx.taskType)) {
    reasons.push(`task match: ${ctx.taskType}`)
  }
  if (pack.activation_signals.risk_profiles?.includes(ctx.riskProfile)) {
    reasons.push(`risk match: ${ctx.riskProfile}`)
  }
  return reasons
}

/** Convergence-based conflict resolution — iterates until the kept set stabilizes. */
function resolveConflicts(
  recommendations: Recommendation[],
  packsById: Map<string, InstructionPack>,
): { kept: Recommendation[]; blocked: BlockedPack[]; stable: boolean } {
  let kept: Recommendation[] = []
  let blocked: BlockedPack[] = []
  let previousKeptIds: string[] = []
  let iterations = 0

  let candidates = [...recommendations]
  while (iterations < MAX_CONVERGENCE_ITERATIONS) {
    kept = []
    blocked = []

    for (const rec of candidates) {
      const pack = packsById.get(rec.packId)
      if (!pack) {
        blocked.push({ packId: rec.packId, reasons: ['pack not found in registry'] })
        continue
      }

      const conflict = kept.find((candidate) => {
        const candidatePack = packsById.get(candidate.packId)
        return candidatePack
          ? candidatePack.conflicts_with.includes(pack.id) || pack.conflicts_with.includes(candidatePack.id)
          : false
      })

      if (conflict) {
        blocked.push({
          packId: rec.packId,
          reasons: [`conflicts with ${conflict.packId}`],
        })
        continue
      }

      kept.push(rec)
    }

    const currentKeptIds = kept.map((r) => r.packId)
    if (
      currentKeptIds.length === previousKeptIds.length &&
      currentKeptIds.every((id, i) => id === previousKeptIds[i])
    ) {
      return { kept, blocked, stable: true }
    }

    previousKeptIds = currentKeptIds
    candidates = kept
    iterations++
  }

  return { kept, blocked, stable: false }
}

// ---------------------------------------------------------------------------
// ActivationContext factory
// ---------------------------------------------------------------------------

let activationCounter = 0

export function createActivationContext(
  projectContext: ProjectContext,
  opts?: { minimumScore?: number; autoApprove?: boolean; failOnWarn?: boolean },
): ActivationContext {
  activationCounter++
  return {
    activationId: `act-${Date.now()}-${activationCounter}`,
    traceId: `trace-${Date.now()}-${activationCounter}`,
    projectContext,
    options: {
      minimumScore: opts?.minimumScore ?? 40,
      autoApprove: opts?.autoApprove ?? false,
      failOnWarn: opts?.failOnWarn ?? false,
    },
    diagnostics: [],
    timings: new Map(),
    aborted: false,
  }
}

// ---------------------------------------------------------------------------
// createOrchestrator
// ---------------------------------------------------------------------------

export function createOrchestrator(options?: OrchestratorOptions) {
  const packsDir = options?.packsDir ?? path.resolve(process.cwd(), 'packs')
  const scorer = options?.scorer ?? defaultScorer
  const hooks = options?.hooks ?? new HookRunner()
  const events = options?.subscribers ?? new ActivationEventEmitter()

  // Content-hash cache — invalidates only when pack files actually change
  let cachedPacks: InstructionPack[] | null = null
  let cachedHash: string | null = null

  async function loadInstructionPacks(forceRefresh = false): Promise<InstructionPack[]> {
    const currentHash = await computeDirectoryHash(packsDir)
    if (!forceRefresh && cachedPacks !== null && currentHash === cachedHash) {
      return cachedPacks
    }

    const result = await validatePackDirectory(packsDir)
    cachedPacks = result.packs
    cachedHash = currentHash
    return cachedPacks
  }

  async function recommendPacks(
    ctx: ProjectContext,
    minimumScore = 40,
    feedbackScores: Record<string, number> = {},
  ): Promise<{
    recommendations: Recommendation[]
    blockedPacks: BlockedPack[]
    packsById: Map<string, InstructionPack>
  }> {
    const actCtx = createActivationContext(ctx, { minimumScore })
    const start = Date.now()

    // Stage 1: Load packs
    if (actCtx.aborted) return { recommendations: [], blockedPacks: [], packsById: new Map() }
    const packs = await loadInstructionPacks()
    const packsById = new Map(packs.map((pack) => [pack.id, pack]))

    await hooks.emit('context:analyzed', actCtx)
    await events.emit({ type: 'context:analyzed', ctx: actCtx })

    // Stage 2: Score packs
    if (actCtx.aborted) return { recommendations: [], blockedPacks: [], packsById }
    const scoringStart = Date.now()

    const scored = packs
      .map((pack) => {
        const rawScore = scorer(pack, ctx, feedbackScores)
        const score = Math.round(rawScore * ctx.confidenceFactor)
        return {
          packId: pack.id,
          version: pack.version,
          score,
          reasons: buildReasons(pack, ctx),
          required: rawScore >= BASE_REQUIRED_THRESHOLD,
        }
      })
      .filter((r) => r.score >= minimumScore)
      .sort((a, b) => b.score - a.score)

    actCtx.timings.set('scoring', Date.now() - scoringStart)
    await hooks.emit('scoring:complete', actCtx, scored)
    await events.emit({ type: 'scoring:complete', ctx: actCtx, recommendations: scored })

    // Stage 3: Resolve conflicts (convergence loop)
    if (actCtx.aborted) return { recommendations: [], blockedPacks: [], packsById }
    const { kept, blocked, stable } = resolveConflicts(scored, packsById)

    if (!stable) {
      actCtx.diagnostics.push({
        severity: 'warning',
        tag: 'conflict',
        packId: '*',
        message: 'Conflict resolution did not converge within iteration limit',
      })
    }

    actCtx.timings.set('total', Date.now() - start)

    return {
      recommendations: kept,
      blockedPacks: blocked,
      packsById,
    }
  }

  async function buildActivationPlan(
    ctx: ProjectContext,
    minimumScore = 40,
    feedbackScores: Record<string, number> = {},
  ): Promise<ActivationPlan> {
    const { recommendations, blockedPacks } = await recommendPacks(ctx, minimumScore, feedbackScores)

    return {
      projectId: ctx.projectId,
      contextSnapshotId: `${ctx.projectId}-${Date.now()}`,
      executionTarget: ctx.executionTarget,
      context: ctx,
      recommendedPacks: recommendations,
      blockedPacks,
      // Pre-policy default — callers must run policyService.applyPolicy() to set the final decision
      policyDecision: 'confirm',
      policyReasons: [],
    }
  }

  /** Full activation pipeline — returns a structured ActivationResult. */
  async function activate(
    ctx: ProjectContext,
    feedbackScores: Record<string, number> = {},
    tokens?: CancellationTokens,
  ): Promise<ActivationResult> {
    const actCtx = createActivationContext(ctx)
    const start = Date.now()

    // Wire cancellation tokens to the activation context
    if (tokens) {
      tokens.abort.signal.addEventListener('abort', () => {
        actCtx.aborted = true
      })
      tokens.cancel.signal.addEventListener('abort', () => {
        actCtx.aborted = true
      })
    }

    try {
      if (actCtx.aborted) {
        return makeActivationError({
          activationId: actCtx.activationId,
          traceId: actCtx.traceId,
          reason: 'cancel',
          analyzerMode: ctx.analyzerMode,
          diagnostics: actCtx.diagnostics,
          durationMs: Date.now() - start,
        })
      }

      const plan = await buildActivationPlan(ctx, actCtx.options.minimumScore, feedbackScores)

      await hooks.emit('activation:before', actCtx, plan)

      const result = makeActivationSuccess({
        activationId: actCtx.activationId,
        traceId: actCtx.traceId,
        plan,
        analyzerMode: ctx.analyzerMode,
        diagnostics: actCtx.diagnostics,
        durationMs: Date.now() - start,
      })

      await hooks.emit('activation:after', actCtx, result)
      await events.emit({ type: 'activation:complete', ctx: actCtx, result })

      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      await hooks.emit('activation:error', actCtx, err)
      await events.emit({ type: 'activation:error', ctx: actCtx, error: err })

      return makeActivationError({
        activationId: actCtx.activationId,
        traceId: actCtx.traceId,
        reason: 'error',
        analyzerMode: ctx.analyzerMode,
        diagnostics: actCtx.diagnostics,
        durationMs: Date.now() - start,
      })
    }
  }

  return {
    service: 'orchestrator' as const,
    status: 'ready' as const,
    packsDir,
    hooks,
    events,
    loadInstructionPacks,
    recommendPacks,
    buildActivationPlan,
    activate,
  }
}

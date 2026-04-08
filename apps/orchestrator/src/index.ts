import path from 'node:path'
import { validatePackDirectory } from '@hub/pack-validator'
import type { ActivationPlan, InstructionPack, ProjectContext, Recommendation } from '@hub/shared-types'
import { scorePack } from './matcher.js'

/** In-process pack registry cache TTL (5 minutes). */
const PACK_CACHE_TTL_MS = 5 * 60 * 1000

type BlockedPack = {
  packId: string
  reasons: string[]
}

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

function resolveConflicts(
  recommendations: Recommendation[],
  packsById: Map<string, InstructionPack>,
): { kept: Recommendation[]; blocked: BlockedPack[] } {
  const kept: Recommendation[] = []
  const blocked: BlockedPack[] = []

  for (const recommendation of recommendations) {
    const pack = packsById.get(recommendation.packId)
    if (!pack) {
      blocked.push({ packId: recommendation.packId, reasons: ['pack not found in registry'] })
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
        packId: recommendation.packId,
        reasons: [`conflicts with ${conflict.packId}`],
      })
      continue
    }

    kept.push(recommendation)
  }

  return { kept, blocked }
}

export function createOrchestrator(options?: { packsDir?: string }) {
  const packsDir = options?.packsDir ?? path.resolve(process.cwd(), 'packs')

  // In-process pack registry cache — avoids re-reading all YAML files on every call
  let cachedPacks: InstructionPack[] | null = null
  let cacheLoadedAt = 0

  async function loadInstructionPacks(forceRefresh = false): Promise<InstructionPack[]> {
    if (!forceRefresh && cachedPacks !== null && Date.now() - cacheLoadedAt < PACK_CACHE_TTL_MS) {
      return cachedPacks
    }
    cachedPacks = await validatePackDirectory(packsDir)
    cacheLoadedAt = Date.now()
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
    const packs = await loadInstructionPacks()
    const packsById = new Map(packs.map((pack) => [pack.id, pack]))

    const scored = packs
      .map((pack) => {
        const rawScore = scorePack(pack, ctx, feedbackScores)
        const score = Math.round(rawScore * ctx.confidenceFactor)
        // Scale the threshold by confidenceFactor so `required` is reachable in every analyzer mode
        const requiredThreshold = Math.round(80 * ctx.confidenceFactor)
        return {
          packId: pack.id,
          version: pack.version,
          score,
          reasons: buildReasons(pack, ctx),
          required: score >= requiredThreshold,
        }
      })
      .filter((recommendation) => recommendation.score >= minimumScore)
      .sort((left, right) => right.score - left.score)

    const { kept, blocked } = resolveConflicts(scored, packsById)

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

  return {
    service: 'orchestrator',
    status: 'ready',
    packsDir,
    loadInstructionPacks,
    recommendPacks,
    buildActivationPlan,
  }
}

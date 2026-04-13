import type { InstructionPack, PackScorer, ProjectContext } from '@hub/shared-types'

const GITNEXUS_TOOL_PREFIX = 'mcp_gitnexus_'
const GITNEXUS_CLI_PACK_ID = 'packforge-cli'
const MEMPALACE_TOOL_PREFIX = 'mempalace_'

/** Maximum score contribution from stack matches to prevent saturation. */
const MAX_STACK_SCORE = 40

/** Points applied per net feedback vote, capped at ±10 total impact. */
const FEEDBACK_POINTS_PER_VOTE = 5
const FEEDBACK_MAX_IMPACT = 10

// ---------------------------------------------------------------------------
// Individual scorers — composable function-types (ni §6.2 inspired)
// ---------------------------------------------------------------------------

/** Stack signal matches: 20pts each, capped at MAX_STACK_SCORE. */
export const stackScorer: PackScorer = (pack, ctx) => {
  const matches = ctx.stack.filter((token) => pack.activation_signals.stack_hints.includes(token)).length
  return Math.min(matches * 20, MAX_STACK_SCORE)
}

/** Phase + domain + task + risk signal matches. */
export const taxonomyScorer: PackScorer = (pack, ctx) => {
  let score = 0
  const signals = pack.activation_signals
  if (signals.phases.includes(ctx.phase)) score += 25
  if (signals.domains.includes(ctx.domain)) score += 20
  if (signals.task_types.includes(ctx.taskType)) score += 20
  if (signals.risk_profiles?.includes(ctx.riskProfile)) score += 10
  return score
}

/** Keyword matches: 5pts each, capped at 15. */
export const keywordScorer: PackScorer = (pack, ctx) => {
  const description = ctx.description.toLowerCase()
  const matches = pack.activation_signals.keywords.filter((k) => description.includes(k.toLowerCase())).length
  return Math.min(matches * 5, 15)
}

/** GitNexus + MemPalace tool awareness. */
export const toolAwarenessScorer: PackScorer = (pack, ctx) => {
  let score = 0
  const usesGitNexusTools = pack.instructions.tools_allowed.some((t) => t.startsWith(GITNEXUS_TOOL_PREFIX))

  if (ctx.hasGitNexusIndex && usesGitNexusTools) {
    score += 25
  }
  if (!ctx.hasGitNexusIndex && ctx.repositoryPath && pack.id === GITNEXUS_CLI_PACK_ID) {
    score += 40
  }

  const usesMemPalaceTools = pack.instructions.tools_allowed.some((t) => t.startsWith(MEMPALACE_TOOL_PREFIX))
  if (ctx.hasMemPalace && usesMemPalaceTools) {
    score += 15
  }

  return score
}

/** Feedback-driven adjustment from user votes. */
export const feedbackScorer: PackScorer = (pack, _ctx, feedbackScores = {}) => {
  const netVotes = feedbackScores[pack.id] ?? 0
  return Math.max(-FEEDBACK_MAX_IMPACT, Math.min(FEEDBACK_MAX_IMPACT, netVotes * FEEDBACK_POINTS_PER_VOTE))
}

/** WorkMode-based category preferences. */
export const workModeScorer: PackScorer = (pack, ctx) => {
  let score = 0
  if (ctx.workMode === 'open-source' && pack.category === 'documentation') score += 10
  if (ctx.workMode === 'solo' && pack.category === 'quality') score += 5
  return score
}

/** Task-intent routing: elevated weight for task-type matches with cross-cutting bonuses. */
export const intentScorer: PackScorer = (pack, ctx) => {
  let score = 0
  const signals = pack.activation_signals

  // Primary: task type match gets a strong bonus (elevated from taxonomyScorer's +20)
  if (signals.task_types.includes(ctx.taskType)) {
    score += 15 // additional +15 on top of taxonomy's +20 = effective +35
  }

  // Cross-cutting: security packs always get a bonus in production/regulated contexts
  if (
    ctx.riskProfile !== 'prototype' &&
    pack.category === 'quality' &&
    signals.risk_profiles?.includes(ctx.riskProfile)
  ) {
    score += 10
  }

  // Cross-cutting: during debug/analyse tasks, quality packs get a bonus
  if ((ctx.taskType === 'debug' || ctx.taskType === 'analyse') && pack.category === 'quality') {
    score += 5
  }

  // Cross-cutting: during deploy, ops packs get a bonus
  if (ctx.taskType === 'deploy' && pack.category === 'ops') {
    score += 5
  }

  return score
}

// ---------------------------------------------------------------------------
// Composite scorer — combines individual scorers
// ---------------------------------------------------------------------------

export type ScorerContribution = {
  name: string
  score: number
}

export type ScoreProvenance = {
  total: number
  contributions: ScorerContribution[]
}

/** Create a composite scorer from an array of named scorers. */
export function createCompositeScorer(scorers: PackScorer[]): PackScorer {
  return (pack, ctx, feedbackScores = {}) => {
    let total = 0
    for (const scorer of scorers) {
      total += scorer(pack, ctx, feedbackScores)
    }
    return Math.max(0, Math.min(total, 100))
  }
}

/** Named scorer entry for provenance tracking. */
export type NamedScorer = { name: string; scorer: PackScorer }

/** Create a composite scorer that also records per-scorer contributions. */
export function createProvenanceScorer(
  named: NamedScorer[],
): PackScorer & {
  provenance: (pack: InstructionPack, ctx: ProjectContext, feedbackScores?: Record<string, number>) => ScoreProvenance
} {
  const score: PackScorer = (pack, ctx, feedbackScores = {}) => {
    let total = 0
    for (const { scorer } of named) {
      total += scorer(pack, ctx, feedbackScores)
    }
    return Math.max(0, Math.min(total, 100))
  }

  const provenance = (
    pack: InstructionPack,
    ctx: ProjectContext,
    feedbackScores: Record<string, number> = {},
  ): ScoreProvenance => {
    const contributions: ScorerContribution[] = []
    let total = 0
    for (const { name, scorer } of named) {
      const s = scorer(pack, ctx, feedbackScores)
      contributions.push({ name, score: s })
      total += s
    }
    return { total: Math.max(0, Math.min(total, 100)), contributions }
  }

  return Object.assign(score, { provenance })
}

const namedScorers: NamedScorer[] = [
  { name: 'stack', scorer: stackScorer },
  { name: 'taxonomy', scorer: taxonomyScorer },
  { name: 'keyword', scorer: keywordScorer },
  { name: 'toolAwareness', scorer: toolAwarenessScorer },
  { name: 'feedback', scorer: feedbackScorer },
  { name: 'workMode', scorer: workModeScorer },
  { name: 'intent', scorer: intentScorer },
]

/** Default composite scorer — identical behavior to the original monolithic scorePack. */
export const defaultScorer: PackScorer = createCompositeScorer([
  stackScorer,
  taxonomyScorer,
  keywordScorer,
  toolAwarenessScorer,
  feedbackScorer,
  workModeScorer,
  intentScorer,
])

/** Default scorer with provenance tracking. */
export const provenanceScorer = createProvenanceScorer(namedScorers)

/**
 * Score a pack against the current project context.
 *
 * This is the backward-compatible entry point. New code should prefer
 * `defaultScorer` or `createCompositeScorer()` directly.
 */
export function scorePack(
  pack: InstructionPack,
  ctx: ProjectContext,
  feedbackScores: Record<string, number> = {},
): number {
  return defaultScorer(pack, ctx, feedbackScores)
}

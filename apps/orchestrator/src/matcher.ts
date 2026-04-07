import type { InstructionPack, ProjectContext } from '@hub/shared-types'

const GITNEXUS_TOOL_PREFIX = 'mcp_gitnexus_'
const GITNEXUS_CLI_PACK_ID = 'packforge-cli'
const MEMPALACE_TOOL_PREFIX = 'mempalace_'

export function scorePack(pack: InstructionPack, ctx: ProjectContext): number {
  let score = 0
  const signals = pack.activation_signals

  const stackMatches = ctx.stack.filter((token) => signals.stack_hints.includes(token)).length
  score += stackMatches * 20

  if (signals.phases.includes(ctx.phase)) score += 25
  if (signals.domains.includes(ctx.domain)) score += 20
  if (signals.task_types.includes(ctx.taskType)) score += 20
  if (signals.risk_profiles?.includes(ctx.riskProfile)) score += 10

  const description = ctx.description.toLowerCase()
  const keywordMatches = signals.keywords.filter((keyword) => description.includes(keyword.toLowerCase())).length
  score += keywordMatches * 5

  // GitNexus-aware scoring
  const usesGitNexusTools = pack.instructions.tools_allowed.some((t) => t.startsWith(GITNEXUS_TOOL_PREFIX))

  if (ctx.hasGitNexusIndex && usesGitNexusTools) {
    // Repo has a GitNexus index → boost all packs that use GitNexus tools
    score += 25
  }

  if (!ctx.hasGitNexusIndex && ctx.repositoryPath && pack.id === GITNEXUS_CLI_PACK_ID) {
    // Repo exists but has no GitNexus index → bootstrap: require packforge-cli
    score += 40
  }

  // MemPalace-aware scoring
  const usesMemPalaceTools = pack.instructions.tools_allowed.some((t) => t.startsWith(MEMPALACE_TOOL_PREFIX))

  if (ctx.hasMemPalace && usesMemPalaceTools) {
    // User has a MemPalace installation → boost packs that use MemPalace tools
    score += 15
  }

  return Math.min(score, 100)
}

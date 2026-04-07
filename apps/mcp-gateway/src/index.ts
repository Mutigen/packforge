import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import yaml from 'js-yaml'
import { createContextAnalyzer } from '@hub/context-analyzer'
import { createMemoryService } from '@hub/memory-service'
import { createOrchestrator } from '@hub/orchestrator'
import { createPolicyService } from '@hub/policy-service'
import {
  AnalyzeProjectInputSchema,
  ProjectContextSchema,
  type ActivationPlan,
  type AnalyzeProjectInput,
  type BootstrapStep,
  type InstructionPack,
  type MissingTool,
  type PendingPack,
  type ProjectContext,
  type RuntimeHandoffContract,
  type RuntimeInstruction,
} from '@hub/shared-types'

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function selectPacks(packsById: Map<string, InstructionPack>, packIds: string[]): InstructionPack[] {
  return packIds.map((packId) => packsById.get(packId)).filter((pack): pack is InstructionPack => Boolean(pack))
}

async function parseSpecFile(filePath: string): Promise<{
  projectId: string
  description: string
  overrides: Partial<AnalyzeProjectInput>
}> {
  const resolvedPath = path.resolve(filePath)
  const content = await readFile(resolvedPath, 'utf8')
  let frontmatter: Record<string, unknown> = {}
  let body = content

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (match && match[1] !== undefined) {
    frontmatter = (yaml.load(match[1]) as Record<string, unknown>) ?? {}
    body = match[2] ?? ''
  }

  const projectId =
    (frontmatter.projectId as string) ?? path.basename(filePath, path.extname(filePath)).replace(/-spec$/, '')

  const overrides: Partial<AnalyzeProjectInput> = {}
  if (frontmatter.domain) overrides.domain = frontmatter.domain as AnalyzeProjectInput['domain']
  if (frontmatter.phase) overrides.phase = frontmatter.phase as AnalyzeProjectInput['phase']
  if (frontmatter.riskProfile) overrides.riskProfile = frontmatter.riskProfile as AnalyzeProjectInput['riskProfile']
  if (frontmatter.taskType) overrides.taskType = frontmatter.taskType as AnalyzeProjectInput['taskType']
  if (frontmatter.workMode) overrides.workMode = frontmatter.workMode as AnalyzeProjectInput['workMode']
  if (frontmatter.executionTarget)
    overrides.executionTarget = frontmatter.executionTarget as AnalyzeProjectInput['executionTarget']
  if (frontmatter.repositoryPath) overrides.repositoryPath = frontmatter.repositoryPath as string
  if (Array.isArray(frontmatter.customKeywords)) overrides.customKeywords = frontmatter.customKeywords as string[]

  return { projectId, description: body.trim(), overrides }
}

function buildBootstrapSteps(ctx: ProjectContext): BootstrapStep[] {
  const steps: BootstrapStep[] = []

  if (ctx.repositoryPath) {
    steps.push({
      id: 'install-deps',
      label: 'Install dependencies',
      command: 'npm install',
      condition: 'if_missing_deps',
      description: 'Install project dependencies if node_modules is missing',
    })

    if (!ctx.hasGitNexusIndex) {
      steps.push({
        id: 'gitnexus-init',
        label: 'Initialize GitNexus index',
        command: 'npx gitnexus@latest analyze',
        condition: 'if_missing_gitnexus',
        description:
          'Create the GitNexus code intelligence graph so that impact analysis, exploration, and refactoring tools are available',
      })
    }
  }

  if (ctx.hasMemPalace) {
    steps.push({
      id: 'mempalace-wakeup',
      label: 'Wake up MemPalace',
      command: 'mempalace status',
      condition: 'if_mempalace_available',
      description:
        'Verify MemPalace is responsive and load palace identity so memory-enriched packs can access past context',
    })
  }

  return steps
}

const GITNEXUS_TOOL_PREFIX = 'mcp_gitnexus_'
const MEMPALACE_TOOL_PREFIX = 'mempalace_'

function packToInstruction(pack: InstructionPack): RuntimeInstruction {
  return {
    packId: pack.id,
    version: pack.version,
    systemPrompt: pack.instructions.system_prompt,
    constraints: pack.instructions.constraints,
    toolsAllowed: pack.instructions.tools_allowed,
    toolsBlocked: pack.instructions.tools_blocked,
  }
}

function buildHandoffContract(
  activationId: string,
  plan: ActivationPlan,
  packs: InstructionPack[],
  evaluation: { approvalRequired: boolean; maxRiskLevel: 'low' | 'medium' | 'high' },
  declinedTools: string[] = [],
): RuntimeHandoffContract {
  const bootstrap = buildBootstrapSteps(plan.context)
  const ctx = plan.context

  const activeInstructions: RuntimeInstruction[] = []
  const pendingPacks: PendingPack[] = []

  for (const pack of packs) {
    const usesGitNexus = pack.instructions.tools_allowed.some((t) => t.startsWith(GITNEXUS_TOOL_PREFIX))
    const usesMemPalace = pack.instructions.tools_allowed.some((t) => t.startsWith(MEMPALACE_TOOL_PREFIX))
    const instruction = packToInstruction(pack)

    if (usesGitNexus && !ctx.hasGitNexusIndex) {
      pendingPacks.push({
        packId: pack.id,
        version: pack.version,
        reason: 'Requires GitNexus index — run `npx gitnexus analyze` to enable',
        requiredTool: 'gitnexus',
        instruction,
      })
    } else if (usesMemPalace && !ctx.hasMemPalace) {
      pendingPacks.push({
        packId: pack.id,
        version: pack.version,
        reason: 'Requires MemPalace — install and configure to enable',
        requiredTool: 'mempalace',
        instruction,
      })
    } else {
      activeInstructions.push(instruction)
    }
  }

  const missingTools: MissingTool[] = []

  if (!ctx.hasGitNexusIndex && ctx.repositoryPath && !declinedTools.includes('gitnexus')) {
    missingTools.push({
      tool: 'gitnexus',
      label: 'GitNexus Code Intelligence',
      description: 'Code intelligence graph for impact analysis, safe refactoring, and codebase exploration.',
      installGuide: 'Run `npx gitnexus@latest analyze` in the project root to create the index.',
      benefits: [
        'Impact analysis before editing — know what breaks',
        'Safe rename and refactoring across the call graph',
        'Execution flow tracing and debugging',
        'Codebase exploration via natural language queries',
      ],
      impactedPacks: pendingPacks.filter((p) => p.requiredTool === 'gitnexus').map((p) => p.packId),
    })
  }

  if (!ctx.hasMemPalace && !declinedTools.includes('mempalace')) {
    missingTools.push({
      tool: 'mempalace',
      label: 'MemPalace Memory Layer',
      description: 'Persistent memory system that carries context, preferences, and learned patterns across sessions.',
      installGuide:
        'Install MemPalace from https://github.com/Mutigen/mempalace and run `mempalace init` to create your palace.',
      benefits: [
        'Persistent memory across conversations and projects',
        'Automatic context loading from previous sessions',
        'Personal identity and preference tracking',
      ],
      impactedPacks: pendingPacks.filter((p) => p.requiredTool === 'mempalace').map((p) => p.packId),
    })
  }

  if (!ctx.hasObsidianVault && !declinedTools.includes('obsidian')) {
    missingTools.push({
      tool: 'obsidian',
      label: 'Obsidian Knowledge Vault',
      description: 'Markdown-based knowledge management connected to your project for documentation and notes.',
      installGuide:
        'Download Obsidian from https://obsidian.md and create a vault in your project directory, or open an existing vault.',
      benefits: [
        'Structured project documentation alongside code',
        'Linked knowledge graph for project decisions and architecture',
        'Markdown-first workflow compatible with version control',
      ],
      impactedPacks: [],
    })
  }

  return {
    contractVersion: '1.0.0',
    activationId,
    projectId: plan.projectId,
    executionTarget: plan.executionTarget,
    workspace: {
      rootPath: plan.context.repositoryPath,
    },
    bootstrap,
    instructions: activeInstructions,
    pendingPacks,
    missingTools,
    policy: {
      approvalRequired: evaluation.approvalRequired,
      maxRiskLevel: evaluation.maxRiskLevel,
      writeAccess: true,
      networkAccess: plan.context.riskProfile !== 'regulated',
      deployAllowed: plan.context.taskType === 'deploy',
    },
    trace: {
      contextSnapshotId: plan.contextSnapshotId,
      generatedAt: new Date().toISOString(),
    },
  }
}

export function createGatewayHandlers(options?: { packsDir?: string; memoryFilePath?: string }) {
  const contextAnalyzer = createContextAnalyzer()
  const orchestrator = createOrchestrator({ packsDir: options?.packsDir ?? path.resolve(process.cwd(), 'packs') })
  const policyService = createPolicyService()
  const memoryService = options?.memoryFilePath
    ? createMemoryService({ filePath: options.memoryFilePath })
    : createMemoryService()

  return {
    async analyzeProjectContext(input: unknown) {
      return contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(input))
    },
    async recommendPacks(input: { context?: ProjectContext; analyze?: unknown }) {
      const ctx = input.context
        ? ProjectContextSchema.parse(input.context)
        : await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(input.analyze))
      const feedbackScores = await memoryService.getPackFeedbackScores(ctx.projectId)
      return orchestrator.recommendPacks(ctx, 40, feedbackScores)
    },
    async activatePackSet(input: { context?: ProjectContext; analyze?: unknown; autoApprove?: boolean }) {
      const ctx = input.context
        ? ProjectContextSchema.parse(input.context)
        : await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(input.analyze))
      const feedbackScores = await memoryService.getPackFeedbackScores(ctx.projectId)
      const recommendations = await orchestrator.recommendPacks(ctx, 40, feedbackScores)
      const packs = selectPacks(
        recommendations.packsById,
        recommendations.recommendations.map((recommendation) => recommendation.packId),
      )
      const evaluation = policyService.evaluateActivation(ctx, packs)
      const plan = policyService.applyPolicy(await orchestrator.buildActivationPlan(ctx), evaluation)

      const status =
        evaluation.decision === 'deny'
          ? 'denied'
          : evaluation.decision === 'confirm' && !input.autoApprove
            ? 'pending_confirmation'
            : 'active'

      const activationId = randomUUID()
      const declinedTools = await memoryService.getDeclinedTools(ctx.projectId)
      const handoff =
        status !== 'denied' ? buildHandoffContract(activationId, plan, packs, evaluation, declinedTools) : undefined

      return memoryService.recordActivation({ id: activationId, status, plan, ...(handoff ? { handoff } : {}) })
    },
    async getActivationStatus(input: { activationId: string }) {
      return memoryService.getActivation(input.activationId)
    },
    async getActiveInstructions(input: { activationId: string }) {
      const activation = await memoryService.getActivation(input.activationId)
      return activation?.handoff ?? null
    },
    async startProjectFromSpec(input: { specFilePath: string; repositoryPath?: string }) {
      const spec = await parseSpecFile(input.specFilePath)
      // If no repositoryPath given, default to the directory containing the spec file.
      // This lets users drop a spec next to package.json and skip the extra argument.
      const resolvedRepoPath = input.repositoryPath ?? path.dirname(path.resolve(input.specFilePath))
      const analyzeInput: AnalyzeProjectInput = {
        projectId: spec.projectId,
        description: spec.description,
        executionTarget: 'client_workspace',
        customKeywords: [],
        ...spec.overrides,
        repositoryPath: resolvedRepoPath,
      }

      const ctx = await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(analyzeInput))
      const feedbackScores = await memoryService.getPackFeedbackScores(ctx.projectId)
      const result = await orchestrator.recommendPacks(ctx, 40, feedbackScores)
      const packs = selectPacks(
        result.packsById,
        result.recommendations.map((r) => r.packId),
      )
      const evaluation = policyService.evaluateActivation(ctx, packs)
      const plan = policyService.applyPolicy(await orchestrator.buildActivationPlan(ctx), evaluation)

      const activationId = randomUUID()
      const declinedTools = await memoryService.getDeclinedTools(ctx.projectId)
      const handoff = buildHandoffContract(activationId, plan, packs, evaluation, declinedTools)

      const activation = await memoryService.recordActivation({
        id: activationId,
        status: evaluation.decision === 'deny' ? 'denied' : 'pending_confirmation',
        plan,
        handoff,
      })

      return {
        activationId: activation.id,
        status: activation.status,
        context: {
          projectId: ctx.projectId,
          domain: ctx.domain,
          phase: ctx.phase,
          taskType: ctx.taskType,
          riskProfile: ctx.riskProfile,
          stack: ctx.stack,
        },
        recommendedPacks: result.recommendations.map((r) => {
          const pack = result.packsById.get(r.packId)
          return {
            packId: r.packId,
            name: pack?.name ?? r.packId,
            description: pack?.description ?? '',
            category: pack?.category,
            score: r.score,
            reasons: r.reasons,
            required: r.required,
          }
        }),
        blockedPacks: result.blockedPacks,
        policyDecision: plan.policyDecision,
        policyReasons: plan.policyReasons,
      }
    },
    async confirmActivation(input: { activationId: string }) {
      const activation = await memoryService.getActivation(input.activationId)
      if (!activation) {
        return { error: `Activation ${input.activationId} not found` }
      }
      if (activation.status === 'denied') {
        return { error: 'Activation was denied by policy', reasons: activation.plan.policyReasons }
      }
      if (activation.status === 'active') {
        return { activationId: activation.id, status: 'active', handoff: activation.handoff }
      }

      const updated = await memoryService.updateActivationStatus(input.activationId, 'active')
      return { activationId: updated!.id, status: 'active', handoff: updated!.handoff }
    },
    async listRegistryPacks() {
      const packs = await orchestrator.loadInstructionPacks()
      return packs.map((pack) => ({
        id: pack.id,
        version: pack.version,
        category: pack.category,
        riskLevel: pack.risk_level,
      }))
    },
    async reloadActivation(input: { activationId: string }) {
      const activation = await memoryService.getActivation(input.activationId)
      if (!activation) return { error: `Activation ${input.activationId} not found` }
      if (!activation.handoff) return { error: 'Activation has no handoff contract' }

      const handoff = activation.handoff
      if (!handoff.pendingPacks || handoff.pendingPacks.length === 0) {
        return { activationId: activation.id, status: 'no_pending_packs', promoted: [], stillPending: [], handoff }
      }

      const ctx = await contextAnalyzer.analyzeProjectContext(
        AnalyzeProjectInputSchema.parse({
          projectId: activation.plan.projectId,
          repositoryPath: handoff.workspace.rootPath,
        }),
      )

      const promoted: string[] = []
      const stillPending: typeof handoff.pendingPacks = []

      for (const pending of handoff.pendingPacks) {
        const isReady =
          (pending.requiredTool === 'gitnexus' && ctx.hasGitNexusIndex) ||
          (pending.requiredTool === 'mempalace' && ctx.hasMemPalace)

        if (isReady) {
          handoff.instructions.push(pending.instruction)
          promoted.push(pending.packId)
        } else {
          stillPending.push(pending)
        }
      }

      handoff.pendingPacks = stillPending
      await memoryService.updateActivationHandoff(input.activationId, handoff)

      return {
        activationId: activation.id,
        promoted,
        stillPending: stillPending.map((p) => ({ packId: p.packId, reason: p.reason })),
        handoff,
      }
    },
    async declineToolSuggestion(input: { tool: string; projectId?: string }) {
      await memoryService.declineToolSuggestion(input.tool, input.projectId)
      const scope = input.projectId ? `for project '${input.projectId}'` : 'globally'
      return {
        declined: input.tool,
        message: `Tool suggestion for '${input.tool}' will no longer appear in handoff contracts (${scope}).`,
      }
    },
    async recordPackFeedback(input: { packId: string; helpful: boolean; note?: string; projectId?: string }) {
      await memoryService.recordFeedback(input.packId, input.helpful, input.note, input.projectId)
      return {
        recorded: true,
        packId: input.packId,
        helpful: input.helpful,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      }
    },
    async getProjectHistory(input: { projectId: string }) {
      return contextAnalyzer.getProjectHistory(input.projectId)
    },
  }
}

export function createMcpGateway(options?: { packsDir?: string; memoryFilePath?: string }) {
  const handlers = createGatewayHandlers(options)
  const server = new McpServer({ name: 'instruction-hub-mcp-gateway', version: '0.1.0' })

  server.registerTool(
    'analyze_project_context',
    {
      description: 'Analyze a project and return its normalized context.',
      inputSchema: AnalyzeProjectInputSchema,
    },
    async (input) => textResult(await handlers.analyzeProjectContext(input)),
  )

  server.registerTool(
    'recommend_packs',
    {
      description: 'Recommend instruction packs for a given context.',
      inputSchema: z.object({
        context: ProjectContextSchema.optional(),
        analyze: AnalyzeProjectInputSchema.optional(),
      }),
    },
    async (input) => {
      const normalizedInput = {
        ...(input.context ? { context: input.context } : {}),
        ...(input.analyze ? { analyze: input.analyze } : {}),
      }
      return textResult(await handlers.recommendPacks(normalizedInput))
    },
  )

  server.registerTool(
    'activate_pack_set',
    {
      description: 'Create an activation from a project context and store the result.',
      inputSchema: z.object({
        context: ProjectContextSchema.optional(),
        analyze: AnalyzeProjectInputSchema.optional(),
        autoApprove: z.boolean().default(false),
      }),
    },
    async (input) => {
      const normalizedInput = {
        ...(input.context ? { context: input.context } : {}),
        ...(input.analyze ? { analyze: input.analyze } : {}),
        autoApprove: input.autoApprove,
      }
      return textResult(await handlers.activatePackSet(normalizedInput))
    },
  )

  server.registerTool(
    'get_activation_status',
    {
      description: 'Return the stored activation record for an activation id.',
      inputSchema: z.object({ activationId: z.string().min(1) }),
    },
    async (input) => textResult(await handlers.getActivationStatus(input)),
  )

  server.registerTool(
    'get_active_instructions',
    {
      description: 'Return the active handoff contract for a stored activation.',
      inputSchema: z.object({ activationId: z.string().min(1) }),
    },
    async (input) => textResult(await handlers.getActiveInstructions(input)),
  )

  server.registerTool(
    'start_project_from_spec',
    {
      description:
        'Read a project spec from a Markdown file, analyze the project context, and recommend instruction packs. Returns recommended packs for user validation before activation. This is the primary entry point — the user writes a .md file with their project idea, and this tool does the rest.',
      inputSchema: z.object({
        specFilePath: z.string().min(1).describe('Absolute path to a .md file describing the project to build'),
        repositoryPath: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Path to the project root for automatic stack detection. Defaults to the directory containing specFilePath — place the spec next to package.json to skip this argument',
          ),
      }),
    },
    async (input) => {
      const args: { specFilePath: string; repositoryPath?: string } = { specFilePath: input.specFilePath }
      if (input.repositoryPath) args.repositoryPath = input.repositoryPath
      return textResult(await handlers.startProjectFromSpec(args))
    },
  )

  server.registerTool(
    'confirm_activation',
    {
      description:
        'Confirm and activate a pending activation after the user has reviewed the recommended packs. Returns the full runtime handoff contract with system prompts, constraints, allowed/blocked tools, and policies.',
      inputSchema: z.object({
        activationId: z.string().min(1).describe('The activationId returned by start_project_from_spec'),
      }),
    },
    async (input) => textResult(await handlers.confirmActivation(input)),
  )

  server.registerTool(
    'reload_activation',
    {
      description:
        'Re-evaluate a stored activation after external tools have been set up (e.g. GitNexus index created, MemPalace installed). Promotes pending packs to active when their required tools become available.',
      inputSchema: z.object({
        activationId: z.string().min(1).describe('The activationId of the activation to reload'),
      }),
    },
    async (input) => textResult(await handlers.reloadActivation(input)),
  )

  server.registerTool(
    'decline_tool_suggestion',
    {
      description:
        'Decline a tool suggestion so it no longer appears in future handoff contracts. Use when the user explicitly does not want to install a recommended tool (e.g. GitNexus, MemPalace).',
      inputSchema: z.object({
        tool: z.string().min(1).describe("The tool identifier to decline, e.g. 'gitnexus', 'mempalace', 'obsidian'"),
        projectId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional project scope. When provided, the declination applies only to this project. Omit to decline globally across all projects.',
          ),
      }),
    },
    async (input) => {
      const args: { tool: string; projectId?: string } = { tool: input.tool }
      if (input.projectId) args.projectId = input.projectId
      return textResult(await handlers.declineToolSuggestion(args))
    },
  )

  server.registerTool(
    'record_pack_feedback',
    {
      description:
        'Record whether a recommended instruction pack was helpful. Feedback influences future scoring — packs marked unhelpful will receive a lower score in subsequent recommendations for the same project.',
      inputSchema: z.object({
        packId: z.string().min(1).describe('The ID of the pack to rate (e.g. "packforge-memory")'),
        helpful: z.boolean().describe('True if the pack was useful, false if it was not.'),
        note: z.string().optional().describe('Optional freeform note explaining the feedback.'),
        projectId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional project scope. When provided, feedback applies only to recommendations for this project.',
          ),
      }),
    },
    async (input) => {
      const args: { packId: string; helpful: boolean; note?: string; projectId?: string } = {
        packId: input.packId,
        helpful: input.helpful,
      }
      if (input.note) args.note = input.note
      if (input.projectId) args.projectId = input.projectId
      return textResult(await handlers.recordPackFeedback(args))
    },
  )

  server.registerTool(
    'get_project_history',
    {
      description:
        'Return the most recent packforge analysis snapshot for a project, previously written to the MemPalace packforge-cache. Surfaces stack evolution, inferred domain/phase, and GitNexus summary from the last time the project was analyzed. Returns null when MemPalace is not installed or the project has not been analyzed before.',
      inputSchema: z.object({
        projectId: z.string().min(1).describe('The project identifier to retrieve history for.'),
      }),
    },
    async (input) => textResult(await handlers.getProjectHistory(input)),
  )

  server.registerTool(
    'list_registry_packs',
    {
      description: 'List the currently compiled runtime packs.',
      inputSchema: z.object({}).optional(),
    },
    async () => textResult(await handlers.listRegistryPacks()),
  )

  return {
    service: 'mcp-gateway',
    status: 'ready',
    server,
    handlers,
  }
}

export async function startMcpGatewayServer(options?: { packsDir?: string; memoryFilePath?: string }) {
  const gateway = createMcpGateway(options)
  const transport = new StdioServerTransport()
  await gateway.server.connect(transport)
  return gateway
}

if (typeof require !== 'undefined' && require.main === module) {
  startMcpGatewayServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

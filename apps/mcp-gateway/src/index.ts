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
  type ProjectContext,
  type RuntimeHandoffContract,
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

function buildHandoffContract(
  activationId: string,
  plan: ActivationPlan,
  packs: InstructionPack[],
  evaluation: { approvalRequired: boolean; maxRiskLevel: 'low' | 'medium' | 'high' },
): RuntimeHandoffContract {
  const bootstrap = buildBootstrapSteps(plan.context)

  return {
    contractVersion: '1.0.0',
    activationId,
    projectId: plan.projectId,
    executionTarget: plan.executionTarget,
    workspace: {
      rootPath: plan.context.repositoryPath,
    },
    bootstrap,
    instructions: packs.map((pack) => ({
      packId: pack.id,
      version: pack.version,
      systemPrompt: pack.instructions.system_prompt,
      constraints: pack.instructions.constraints,
      toolsAllowed: pack.instructions.tools_allowed,
      toolsBlocked: pack.instructions.tools_blocked,
    })),
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
      return orchestrator.recommendPacks(ctx)
    },
    async activatePackSet(input: { context?: ProjectContext; analyze?: unknown; autoApprove?: boolean }) {
      const ctx = input.context
        ? ProjectContextSchema.parse(input.context)
        : await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(input.analyze))
      const recommendations = await orchestrator.recommendPacks(ctx)
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
      const handoff = status !== 'denied' ? buildHandoffContract(activationId, plan, packs, evaluation) : undefined

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
      const result = await orchestrator.recommendPacks(ctx)
      const packs = selectPacks(
        result.packsById,
        result.recommendations.map((r) => r.packId),
      )
      const evaluation = policyService.evaluateActivation(ctx, packs)
      const plan = policyService.applyPolicy(await orchestrator.buildActivationPlan(ctx), evaluation)

      const activationId = randomUUID()
      const handoff = buildHandoffContract(activationId, plan, packs, evaluation)

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

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { z } from 'zod'
import { buildPackRegistry, getPackRegistryEntry, listPackFiles, validatePackDirectory } from '@hub/pack-validator'
import { createContextAnalyzer } from '@hub/context-analyzer'
import { createKnowledgeCompiler } from '@hub/knowledge-compiler'
import { createMemoryService } from '@hub/memory-service'
import { createOrchestrator } from '@hub/orchestrator'
import { createPolicyService } from '@hub/policy-service'
import {
  ActivationPlanSchema,
  AnalyzeProjectInputSchema,
  ProjectContextSchema,
  RuntimeHandoffContractSchema,
  type InstructionPack,
  type ProjectContext,
  type RuntimeHandoffContract,
} from '@hub/shared-types'

function selectPacks(packsById: Map<string, InstructionPack>, packIds: string[]): InstructionPack[] {
  return packIds.map((packId) => packsById.get(packId)).filter((pack): pack is InstructionPack => Boolean(pack))
}

function buildHandoffContract(input: {
  activationId: string
  contextSnapshotId: string
  ctx: ProjectContext
  packs: InstructionPack[]
  approvalRequired: boolean
  maxRiskLevel: 'low' | 'medium' | 'high'
}): RuntimeHandoffContract {
  return RuntimeHandoffContractSchema.parse({
    contractVersion: '1.0.0',
    activationId: input.activationId,
    projectId: input.ctx.projectId,
    executionTarget: input.ctx.executionTarget,
    workspace: {
      rootPath: input.ctx.repositoryPath,
      branchName: 'main',
    },
    instructions: input.packs.map((pack) => ({
      packId: pack.id,
      version: pack.version,
      systemPrompt: pack.instructions.system_prompt,
      constraints: pack.instructions.constraints,
      toolsAllowed: pack.instructions.tools_allowed,
      toolsBlocked: pack.instructions.tools_blocked,
    })),
    policy: {
      approvalRequired: input.approvalRequired,
      maxRiskLevel: input.maxRiskLevel,
      writeAccess: true,
      networkAccess: true,
      deployAllowed: input.ctx.taskType === 'deploy' && !input.approvalRequired,
    },
    trace: {
      contextSnapshotId: input.contextSnapshotId,
      generatedAt: new Date().toISOString(),
    },
  })
}

export function createHubApiApp(options?: { packsDir?: string; memoryFilePath?: string }) {
  const app = Fastify({ logger: false })
  const packsDir = options?.packsDir ?? path.resolve(process.cwd(), 'packs')
  const contextAnalyzer = createContextAnalyzer()
  const orchestrator = createOrchestrator({ packsDir })
  const policyService = createPolicyService()
  const memoryService = options?.memoryFilePath
    ? createMemoryService({ filePath: options.memoryFilePath })
    : createMemoryService()
  const knowledgeCompiler = createKnowledgeCompiler()

  app.register(cors)

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/contexts/analyze', async (request) => {
    const input = AnalyzeProjectInputSchema.parse(request.body)
    return contextAnalyzer.analyzeProjectContext(input)
  })

  app.post('/compiler/run', async (request) => {
    const body = z
      .object({ vaultPath: z.string().min(1), outputPath: z.string().min(1).optional() })
      .parse(request.body)
    return knowledgeCompiler.compileVault({
      vaultPath: body.vaultPath,
      outputPath: body.outputPath ?? packsDir,
    })
  })

  app.get('/packs', async () => {
    const packs = await validatePackDirectory(packsDir)
    const files = await listPackFiles(packsDir)
    const filePathByPackId = new Map<string, string>()
    for (const filePath of files) {
      const packId = path.basename(filePath, '.yaml')
      filePathByPackId.set(packId, filePath)
    }
    return buildPackRegistry(packs, filePathByPackId)
  })

  app.get('/registry', async () => {
    const packs = await validatePackDirectory(packsDir)
    const files = await listPackFiles(packsDir)
    return packs.map((pack) => {
      const filePath = files.find((candidate) => candidate.endsWith(`${pack.id}.yaml`))
      return getPackRegistryEntry(pack, filePath ?? `${pack.id}.yaml`)
    })
  })

  app.post('/recommendations', async (request) => {
    const body = z
      .object({
        context: ProjectContextSchema.optional(),
        input: z.unknown().optional(),
        minimumScore: z.number().optional(),
      })
      .parse(request.body)
    const ctx = body.context
      ? body.context
      : await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(body.input))
    const feedbackScores = await memoryService.getPackFeedbackScores(ctx.projectId)
    const recommendations = await orchestrator.recommendPacks(ctx, body.minimumScore, feedbackScores)
    return { context: ctx, ...recommendations }
  })

  app.post('/activations', async (request, reply) => {
    const body = z
      .object({
        context: ProjectContextSchema.optional(),
        input: z.unknown().optional(),
        autoApprove: z.boolean().optional(),
      })
      .parse(request.body)
    const ctx = body.context
      ? body.context
      : await contextAnalyzer.analyzeProjectContext(AnalyzeProjectInputSchema.parse(body.input))
    const feedbackScores = await memoryService.getPackFeedbackScores(ctx.projectId)
    const recommendationResult = await orchestrator.recommendPacks(ctx, 40, feedbackScores)
    const packs = selectPacks(
      recommendationResult.packsById,
      recommendationResult.recommendations.map((recommendation) => recommendation.packId),
    )
    const basePlan = ActivationPlanSchema.parse({
      projectId: ctx.projectId,
      contextSnapshotId: `${ctx.projectId}-${Date.now()}`,
      executionTarget: ctx.executionTarget,
      context: ctx,
      recommendedPacks: recommendationResult.recommendations,
      blockedPacks: recommendationResult.blockedPacks,
      policyDecision: 'allow',
      policyReasons: [],
    })
    const evaluation = policyService.evaluateActivation(ctx, packs)
    const plan = policyService.applyPolicy(basePlan, evaluation)

    if (evaluation.decision === 'deny') {
      const activation = await memoryService.recordActivation({ status: 'denied', plan })
      reply.code(403)
      return { activation }
    }

    if (evaluation.decision === 'confirm' && !body.autoApprove) {
      const activation = await memoryService.recordActivation({ status: 'pending_confirmation', plan })
      reply.code(202)
      return { activation }
    }

    const activationId = randomUUID()
    const handoff = buildHandoffContract({
      activationId,
      contextSnapshotId: plan.contextSnapshotId,
      ctx,
      packs,
      approvalRequired: evaluation.approvalRequired,
      maxRiskLevel: evaluation.maxRiskLevel,
    })
    const activation = await memoryService.recordActivation({ status: 'active', plan, handoff })

    return { activation }
  })

  app.get('/activations/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const activation = await memoryService.getActivation(params.id)
    if (!activation) {
      reply.code(404)
      return { error: 'activation not found' }
    }
    return activation
  })

  app.post('/feedback', async (request, reply) => {
    const body = z
      .object({
        packId: z.string().min(1),
        helpful: z.boolean(),
        note: z.string().optional(),
        projectId: z.string().min(1).optional(),
      })
      .parse(request.body)
    await memoryService.recordFeedback(body.packId, body.helpful, body.note, body.projectId)
    return { recorded: true, packId: body.packId, helpful: body.helpful }
  })

  return app
}

export type HubApiApp = ReturnType<typeof createHubApiApp>

if (typeof require !== 'undefined' && require.main === module) {
  const app = createHubApiApp()
  const port = Number(process.env.PORT ?? 3001)
  app.listen({ port, host: '0.0.0.0' }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

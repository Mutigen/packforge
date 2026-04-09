import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import type { AnalyzerSource, StackSignal } from '@hub/shared-types'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrchestrator } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))),
  )
})

async function writePack(packsDir: string, id: string, extra: Record<string, unknown> = {}) {
  await mkdir(path.join(packsDir, 'engineering'), { recursive: true })
  await writeFile(
    path.join(packsDir, 'engineering', `${id}.yaml`),
    `id: ${id}
version: 1.0.0
name: ${id.charAt(0).toUpperCase() + id.slice(1)}
description: Engineering pack for backend architecture decisions.
category: engineering
domain: [saas]
phase: [mvp]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: ${id} prompt
  constraints: []
  tools_allowed: [read_file]
  tools_blocked: []
activation_signals:
  keywords: [api]
  stack_hints: [node, fastify]
  task_types: [build]
  domains: [saas]
  phases: [mvp]
  risk_profiles: [production]
conflicts_with: [${extra['conflicts_with'] ?? ''}]
compatible_with: []
approval:
  state: approved
maturity:
  level: stable
execution_policy:
  allowed_targets: [client_workspace]
  requires_human_confirm: false
`,
  )
}

const baseCtx = {
  projectId: 'proj',
  description: 'Build an API',
  stack: ['node', 'fastify'] as StackSignal[],
  phase: 'mvp' as const,
  domain: 'saas' as const,
  taskType: 'build' as const,
  riskProfile: 'production' as const,
  customKeywords: [] as string[],
  analyzerMode: 'manual' as const,
  analyzerSources: ['user-form'] as AnalyzerSource[],
  confidenceFactor: 1,
  analyzedAt: new Date().toISOString(),
  executionTarget: 'client_workspace' as const,
  hasGitNexusIndex: false,
  gitNexusClusters: [] as string[],
  gitNexusProcessLabels: [] as string[],
  hasMemPalace: false,
  mempalaceProjectIndexed: false,
  hasObsidianVault: false,
  obsidianVaults: [] as string[],
}

describe('createOrchestrator', () => {
  it('recommends matching packs and blocks conflicts', async () => {
    const packsDir = await mkdtemp(path.join(os.tmpdir(), 'orchestrator-packs-'))
    tempDirs.push(packsDir)
    await writePack(packsDir, 'alpha')
    await writePack(packsDir, 'beta', { conflicts_with: 'alpha' })

    const orchestrator = createOrchestrator({ packsDir })
    const result = await orchestrator.recommendPacks(baseCtx)

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]?.packId).toBe('alpha')
    expect(result.blockedPacks[0]?.packId).toBe('beta')
  })

  it('applies negative feedback to reduce a pack score', async () => {
    const packsDir = await mkdtemp(path.join(os.tmpdir(), 'orchestrator-feedback-'))
    tempDirs.push(packsDir)
    // Pack only matches stack + phase (40+25=65 raw) — well below the 100 cap so feedback is visible
    await mkdir(path.join(packsDir, 'engineering'), { recursive: true })
    await writeFile(
      path.join(packsDir, 'engineering', 'gamma.yaml'),
      `id: gamma
version: 1.0.0
name: Gamma
description: Partial-match engineering pack.
category: engineering
domain: [saas]
phase: [mvp]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: gamma prompt
  constraints: []
  tools_allowed: [read_file]
  tools_blocked: []
activation_signals:
  keywords: []
  stack_hints: [node, fastify]
  task_types: []
  domains: []
  phases: [mvp]
  risk_profiles: []
conflicts_with: []
compatible_with: []
approval:
  state: approved
maturity:
  level: stable
execution_policy:
  allowed_targets: [client_workspace]
  requires_human_confirm: false
`,
    )

    const orchestrator = createOrchestrator({ packsDir })

    // Without feedback, gamma should score above threshold (stack match 40 + phase 25 = 65 × 1 = 65 ≥ 40)
    const before = await orchestrator.recommendPacks(baseCtx, 40, {})
    const beforeScore = before.recommendations.find((r) => r.packId === 'gamma')?.score ?? 0
    expect(beforeScore).toBeGreaterThanOrEqual(40)

    // Negative feedback impact: net votes × 5 pts per vote, capped at ±10 total impact
    const feedbackScores: Record<string, number> = { gamma: -5 }
    const after = await orchestrator.recommendPacks(baseCtx, 40, feedbackScores)
    const afterScore = after.recommendations.find((r) => r.packId === 'gamma')?.score ?? 0

    // Score should have decreased by the capped feedback delta
    expect(afterScore).toBeLessThan(beforeScore)
  })

  it('caches the pack registry and returns same instance within TTL', async () => {
    const packsDir = await mkdtemp(path.join(os.tmpdir(), 'orchestrator-cache-'))
    tempDirs.push(packsDir)
    await writePack(packsDir, 'delta')

    const orchestrator = createOrchestrator({ packsDir })
    const first = await orchestrator.loadInstructionPacks()
    const second = await orchestrator.loadInstructionPacks()

    // Same array reference — no re-load within TTL
    expect(first).toBe(second)
  })
})

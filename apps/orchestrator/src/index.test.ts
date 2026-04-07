import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
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

describe('createOrchestrator', () => {
  it('recommends matching packs and blocks conflicts', async () => {
    const packsDir = await mkdtemp(path.join(os.tmpdir(), 'orchestrator-packs-'))
    tempDirs.push(packsDir)
    await mkdir(path.join(packsDir, 'engineering'), { recursive: true })

    await writeFile(
      path.join(packsDir, 'engineering', 'alpha.yaml'),
      `id: alpha
version: 1.0.0
name: Alpha
description: Matching engineering pack for backend architecture decisions.
category: engineering
domain: [saas]
phase: [mvp]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: Alpha prompt
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
conflicts_with: []
compatible_with: [beta]
approval:
  state: approved
maturity:
  level: stable
execution_policy:
  allowed_targets: [client_workspace]
  requires_human_confirm: false
`,
    )

    await writeFile(
      path.join(packsDir, 'engineering', 'beta.yaml'),
      `id: beta
version: 1.0.0
name: Beta
description: Conflicting engineering pack for the same scenario.
category: engineering
domain: [saas]
phase: [mvp]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: Beta prompt
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
conflicts_with: [alpha]
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
    const result = await orchestrator.recommendPacks({
      projectId: 'proj',
      description: 'Build an API',
      stack: ['node', 'fastify'],
      phase: 'mvp',
      domain: 'saas',
      taskType: 'build',
      riskProfile: 'production',
      customKeywords: [],
      analyzerMode: 'manual',
      analyzerSources: ['user-form'],
      confidenceFactor: 1,
      analyzedAt: new Date().toISOString(),
      executionTarget: 'client_workspace',
      hasGitNexusIndex: false,
      gitNexusClusters: [],
      hasMemPalace: false,
    })

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]?.packId).toBe('alpha')
    expect(result.blockedPacks[0]?.packId).toBe('beta')
  })
})

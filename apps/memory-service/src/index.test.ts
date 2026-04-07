import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationPlan } from '@hub/shared-types'
import { createMemoryService } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function makePlan(projectId = 'proj'): ActivationPlan {
  return {
    projectId,
    contextSnapshotId: 'ctx-1',
    executionTarget: 'client_workspace',
    context: {
      projectId,
      description: 'test',
      stack: ['node'],
      phase: 'mvp',
      domain: 'saas',
      taskType: 'build',
      riskProfile: 'prototype',
      customKeywords: [],
      analyzerMode: 'manual',
      analyzerSources: ['user-form'],
      confidenceFactor: 1,
      analyzedAt: new Date().toISOString(),
      executionTarget: 'client_workspace',
      hasGitNexusIndex: false,
      gitNexusClusters: [],
      gitNexusProcessLabels: [],
      hasMemPalace: false,
      hasObsidianVault: false,
      obsidianVaults: [],
    },
    recommendedPacks: [],
    blockedPacks: [],
    policyDecision: 'allow',
    policyReasons: [],
  }
}

describe('createMemoryService', () => {
  it('persists activations and feedback', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-service-'))
    tempDirs.push(dir)
    const service = createMemoryService({ filePath: path.join(dir, 'memory.json') })
    const plan = makePlan()

    const activation = await service.recordActivation({ status: 'active', plan })
    await service.recordFeedback('safe-pack', true, 'helpful')
    const stored = await service.getActivation(activation.id)

    expect(stored?.id).toBe(activation.id)
    expect(await service.listActivations()).toHaveLength(1)
  })

  it('prunes oldest activations when maxActivations is exceeded', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-service-prune-'))
    tempDirs.push(dir)
    const service = createMemoryService({ filePath: path.join(dir, 'memory.json'), maxActivations: 3 })

    for (let i = 0; i < 5; i++) {
      await service.recordActivation({ status: 'active', plan: makePlan(`proj-${i}`) })
    }

    const all = await service.listActivations()
    expect(all).toHaveLength(3)
    // Most recent should be retained (unshift order)
    expect(all[0]?.plan.projectId).toBe('proj-4')
    expect(all[2]?.plan.projectId).toBe('proj-2')
  })

  it('supports project-scoped declined tools', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-service-decline-'))
    tempDirs.push(dir)
    const service = createMemoryService({ filePath: path.join(dir, 'memory.json') })

    await service.declineToolSuggestion('gitnexus') // global
    await service.declineToolSuggestion('mempalace', 'proj-a') // project-specific

    expect(await service.getDeclinedTools()).toEqual(['gitnexus'])
    expect(await service.getDeclinedTools('proj-a')).toEqual(['gitnexus', 'mempalace'])
    expect(await service.getDeclinedTools('proj-b')).toEqual(['gitnexus'])
  })

  it('computes feedback scores with project scoping', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-service-scores-'))
    tempDirs.push(dir)
    const service = createMemoryService({ filePath: path.join(dir, 'memory.json') })

    // Global feedback
    await service.recordFeedback('pack-a', true)
    await service.recordFeedback('pack-a', true)
    await service.recordFeedback('pack-b', false)

    // Project-specific feedback overrides global for that pack
    await service.recordFeedback('pack-a', false, undefined, 'proj-x')

    const globalScores = await service.getPackFeedbackScores()
    expect(globalScores['pack-a']).toBe(2) // 2 global helpful
    expect(globalScores['pack-b']).toBe(-1)

    const projectScores = await service.getPackFeedbackScores('proj-x')
    // pack-a has project entry → global entries for pack-a are excluded
    expect(projectScores['pack-a']).toBe(-1)
    // pack-b has no project entry → global entry is used
    expect(projectScores['pack-b']).toBe(-1)
  })

  it('clamps feedback scores to [-5, +5]', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-service-clamp-'))
    tempDirs.push(dir)
    const service = createMemoryService({ filePath: path.join(dir, 'memory.json') })

    for (let i = 0; i < 10; i++) {
      await service.recordFeedback('pack-a', true)
    }

    const scores = await service.getPackFeedbackScores()
    expect(scores['pack-a']).toBe(5)
  })
})

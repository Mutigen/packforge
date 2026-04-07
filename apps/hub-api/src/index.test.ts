import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHubApiApp } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createPackFixture(root: string) {
  await mkdir(path.join(root, 'engineering'), { recursive: true })
  await writeFile(
    path.join(root, 'engineering', 'backend-architect.yaml'),
    `id: backend-architect
version: 1.0.0
name: Backend Architect
description: Specialization for backend system design and API contracts.
category: engineering
domain: [saas]
phase: [mvp]
risk_level: low
personality:
  tone: precise
  reasoning_style: trade-off-first
  output_format: structured
instructions:
  system_prompt: You are a backend architect.
  constraints: []
  tools_allowed: [read_file]
  tools_blocked: []
activation_signals:
  keywords: [api]
  stack_hints: [node, fastify]
  task_types: [build]
  domains: [saas]
  phases: [mvp]
  risk_profiles: [prototype]
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
}

describe('createHubApiApp', () => {
  it('serves recommendations and stores an activation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hub-api-'))
    tempDirs.push(root)
    const packsDir = path.join(root, 'packs')
    await createPackFixture(packsDir)

    const app = createHubApiApp({ packsDir, memoryFilePath: path.join(root, 'memory.json') })

    const recommendationResponse = await app.inject({
      method: 'POST',
      url: '/recommendations',
      payload: {
        context: {
          projectId: 'proj',
          description: 'Build a Fastify API',
          stack: ['node', 'fastify'],
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
      },
    })

    const activationResponse = await app.inject({
      method: 'POST',
      url: '/activations',
      payload: {
        context: {
          projectId: 'proj',
          description: 'Build a Fastify API',
          stack: ['node', 'fastify'],
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
        autoApprove: true,
      },
    })

    expect(recommendationResponse.statusCode).toBe(200)
    expect(recommendationResponse.json().recommendations[0].packId).toBe('backend-architect')
    expect(activationResponse.statusCode).toBe(200)
    expect(activationResponse.json().activation.status).toBe('active')
  })
})

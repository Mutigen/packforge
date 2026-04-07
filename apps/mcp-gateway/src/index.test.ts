import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayHandlers } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createGatewayHandlers', () => {
  it('creates a pending activation for deploy flows without auto approval', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-gateway-'))
    tempDirs.push(root)
    const packsDir = path.join(root, 'packs')
    await mkdir(path.join(packsDir, 'engineering'), { recursive: true })
    await writeFile(
      path.join(packsDir, 'engineering', 'deployer.yaml'),
      `id: deployer
version: 1.0.0
name: Deployer
description: Deployment oriented instruction pack.
category: ops
domain: [saas]
phase: [mvp]
risk_level: medium
personality:
  tone: precise
  reasoning_style: risk-first
  output_format: structured
instructions:
  system_prompt: Deploy carefully.
  constraints: []
  tools_allowed: [read_file]
  tools_blocked: []
activation_signals:
  keywords: [deploy]
  stack_hints: [node]
  task_types: [deploy]
  domains: [saas]
  phases: [mvp]
  risk_profiles: [production]
conflicts_with: []
compatible_with: []
approval:
  state: approved
maturity:
  level: stable
execution_policy:
  allowed_targets: [client_workspace]
  requires_human_confirm: true
`,
    )

    const handlers = createGatewayHandlers({ packsDir, memoryFilePath: path.join(root, 'memory.json') })
    const activation = await handlers.activatePackSet({
      context: {
        projectId: 'proj',
        description: 'Deploy service',
        stack: ['node'],
        phase: 'mvp',
        domain: 'saas',
        taskType: 'deploy',
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
      },
    })

    expect(activation.status).toBe('pending_confirmation')
  })
})

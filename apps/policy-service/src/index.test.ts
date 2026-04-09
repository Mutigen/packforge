import { describe, expect, it } from 'vitest'
import type { InstructionPack, ProjectContext } from '@hub/shared-types'
import { createPolicyService } from './index.js'

const baseContext: ProjectContext = {
  projectId: 'proj',
  description: 'Deploy regulated fintech service',
  stack: ['node'],
  phase: 'mvp',
  domain: 'fintech',
  taskType: 'deploy',
  riskProfile: 'regulated',
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
  mempalaceProjectIndexed: false,
  hasObsidianVault: false,
  obsidianVaults: [],
}

const lowRiskPack: InstructionPack = {
  id: 'safe-pack',
  version: '1.0.0',
  name: 'Safe Pack',
  description: 'A safe pack for controlled testing.',
  category: 'engineering',
  domain: ['fintech'],
  phase: ['mvp'],
  risk_level: 'low',
  personality: { tone: 'precise', reasoning_style: 'trade-off-first', output_format: 'structured' },
  instructions: { system_prompt: 'prompt', constraints: [], tools_allowed: [], tools_blocked: [] },
  activation_signals: {
    keywords: [],
    stack_hints: ['node'],
    task_types: ['deploy'],
    domains: ['fintech'],
    phases: ['mvp'],
    risk_profiles: ['regulated'],
  },
  conflicts_with: [],
  compatible_with: [],
  approval: { state: 'approved' },
  maturity: { level: 'stable' },
  execution_policy: { allowed_targets: ['client_workspace'], requires_human_confirm: false },
}

describe('createPolicyService', () => {
  it('requires confirmation for regulated deploy flows', () => {
    const service = createPolicyService()
    const evaluation = service.evaluateActivation(baseContext, [lowRiskPack])

    expect(evaluation.decision).toBe('confirm')
    expect(evaluation.approvalRequired).toBe(true)
    expect(evaluation.reasons).toEqual(
      expect.arrayContaining([
        'regulated projects require human confirmation',
        'deploy flows require human confirmation',
      ]),
    )
  })
})

import { describe, expect, it } from 'vitest'
import type { InstructionPack } from '@hub/shared-types'
import { buildPackRegistry, validatePackCollection } from './index.js'

const basePack: Omit<InstructionPack, 'id'> = {
  version: '1.0.0',
  name: 'Base Pack',
  description: 'A valid test instruction pack for registry generation.',
  category: 'engineering',
  domain: ['saas'],
  phase: ['mvp'],
  risk_level: 'low',
  personality: { tone: 'precise', reasoning_style: 'trade-off-first', output_format: 'structured' },
  instructions: { system_prompt: 'prompt', constraints: [], tools_allowed: [], tools_blocked: [], tool_priority: [] },
  activation_signals: {
    keywords: [],
    stack_hints: [],
    task_types: [],
    domains: ['saas'],
    phases: ['mvp'],
    risk_profiles: [],
  },
  conflicts_with: [],
  compatible_with: [],
  approval: { state: 'approved' },
  maturity: { level: 'stable' },
  execution_policy: { allowed_targets: ['client_workspace'], requires_human_confirm: false },
}

describe('pack-validator', () => {
  it('builds a registry from validated packs', () => {
    const result = validatePackCollection([
      { ...basePack, id: 'alpha', compatible_with: ['beta'] },
      { ...basePack, id: 'beta' },
    ])

    const registry = buildPackRegistry(
      result.packs,
      new Map([
        ['alpha', 'packs/engineering/alpha.yaml'],
        ['beta', 'packs/engineering/beta.yaml'],
      ]),
    )

    expect(registry).toHaveLength(2)
    expect(registry[0]?.id).toBe('alpha')
  })

  it('detects asymmetric compatible_with relationships', () => {
    const result = validatePackCollection([
      { ...basePack, id: 'alpha', compatible_with: ['beta'] },
      { ...basePack, id: 'beta', compatible_with: [] },
    ])

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('asymmetric-compatible-with')
    expect(result.warnings[0]?.packId).toBe('alpha')
    expect(result.warnings[0]?.referencedPackId).toBe('beta')
  })

  it('returns no warnings for symmetric compatible_with', () => {
    const result = validatePackCollection([
      { ...basePack, id: 'alpha', compatible_with: ['beta'] },
      { ...basePack, id: 'beta', compatible_with: ['alpha'] },
    ])

    expect(result.warnings).toHaveLength(0)
  })
})

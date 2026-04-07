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
  instructions: { system_prompt: 'prompt', constraints: [], tools_allowed: [], tools_blocked: [] },
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
    const packs = validatePackCollection([
      { ...basePack, id: 'alpha', compatible_with: ['beta'] },
      { ...basePack, id: 'beta' },
    ])

    const registry = buildPackRegistry(
      packs,
      new Map([
        ['alpha', 'packs/engineering/alpha.yaml'],
        ['beta', 'packs/engineering/beta.yaml'],
      ]),
    )

    expect(registry).toHaveLength(2)
    expect(registry[0]?.id).toBe('alpha')
  })
})

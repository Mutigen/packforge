import { describe, expect, it } from 'vitest'
import { exportForHarness } from './index.js'
import type { RuntimeHandoffContract } from '@hub/shared-types'

const baseHandoff: RuntimeHandoffContract = {
  contractVersion: '1.0.0',
  activationId: 'test-activation-id',
  projectId: 'test-project',
  executionTarget: 'client_workspace',
  workspace: { rootPath: '/tmp/project' },
  bootstrap: [],
  instructions: [
    {
      packId: 'security-baseline',
      version: '1.0.0',
      systemPrompt: 'You are a security baseline enforcer.',
      constraints: ['Never commit secrets', 'Validate all inputs'],
      toolsAllowed: ['read_file', 'search'],
      toolsBlocked: ['deploy'],
    },
    {
      packId: 'verification-loop',
      version: '1.0.0',
      systemPrompt: 'You enforce a strict verification loop.',
      constraints: ['Run full cycle after every change'],
      toolsAllowed: ['run_in_terminal', 'read_file'],
      toolsBlocked: [],
    },
  ],
  pendingPacks: [],
  missingTools: [],
  policy: {
    approvalRequired: false,
    maxRiskLevel: 'medium',
    writeAccess: true,
    networkAccess: true,
    deployAllowed: false,
  },
  trace: {
    contextSnapshotId: 'snap-123',
    generatedAt: '2024-01-01T00:00:00.000Z',
  },
}

const emptyHandoff: RuntimeHandoffContract = {
  ...baseHandoff,
  instructions: [],
}

describe('exportForHarness', () => {
  describe('cursor format', () => {
    it('returns the correct filePath', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      expect(result.filePath).toBe('.cursorrules')
      expect(result.format).toBe('cursor')
    })

    it('includes the activationId header', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      expect(result.content).toContain('test-activation-id')
    })

    it('merges system prompts with separator', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      expect(result.content).toContain('You are a security baseline enforcer.')
      expect(result.content).toContain('You enforce a strict verification loop.')
      expect(result.content).toContain('---')
    })

    it('includes constraints section', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      expect(result.content).toContain('## Constraints')
      expect(result.content).toContain('- Never commit secrets')
      expect(result.content).toContain('- Validate all inputs')
    })

    it('includes tools section with allowed and blocked', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      expect(result.content).toContain('## Tools')
      expect(result.content).toContain('### Allowed')
      expect(result.content).toContain('read_file')
      expect(result.content).toContain('### Blocked')
      expect(result.content).toContain('deploy')
    })

    it('deduplicates tools_allowed across instructions', () => {
      const result = exportForHarness(baseHandoff, 'cursor')
      const matches = (result.content.match(/- read_file/g) ?? []).length
      expect(matches).toBe(1)
    })

    it('handles empty instructions gracefully', () => {
      const result = exportForHarness(emptyHandoff, 'cursor')
      expect(result.content).toContain('test-activation-id')
      expect(result.content).not.toContain('## Constraints')
      expect(result.content).not.toContain('## Tools')
    })
  })

  describe('claude-code format', () => {
    it('returns the correct filePath', () => {
      const result = exportForHarness(baseHandoff, 'claude-code')
      expect(result.filePath).toBe('CLAUDE.md')
      expect(result.format).toBe('claude-code')
    })

    it('includes Rules section with Must Never for negative constraints', () => {
      const result = exportForHarness(baseHandoff, 'claude-code')
      expect(result.content).toContain('## Rules')
      expect(result.content).toContain('### Must Never')
      expect(result.content).toContain('Never commit secrets')
    })

    it('includes Must Always for affirmative constraints', () => {
      const result = exportForHarness(baseHandoff, 'claude-code')
      expect(result.content).toContain('### Must Always')
      expect(result.content).toContain('Validate all inputs')
    })

    it('includes blocked tools', () => {
      const result = exportForHarness(baseHandoff, 'claude-code')
      expect(result.content).toContain('## Blocked Tools')
      expect(result.content).toContain('deploy')
    })

    it('handles empty instructions gracefully', () => {
      const result = exportForHarness(emptyHandoff, 'claude-code')
      expect(result.content).toContain('test-activation-id')
    })
  })

  describe('codex format', () => {
    it('returns the correct filePath', () => {
      const result = exportForHarness(baseHandoff, 'codex')
      expect(result.filePath).toBe('.codex/instructions.md')
      expect(result.format).toBe('codex')
    })

    it('includes system context section', () => {
      const result = exportForHarness(baseHandoff, 'codex')
      expect(result.content).toContain('## System Context')
      expect(result.content).toContain('You are a security baseline enforcer.')
    })

    it('includes policy section', () => {
      const result = exportForHarness(baseHandoff, 'codex')
      expect(result.content).toContain('## Policy')
      expect(result.content).toContain('Max risk level: medium')
    })

    it('handles empty instructions gracefully', () => {
      const result = exportForHarness(emptyHandoff, 'codex')
      expect(result.content).toContain('## Policy')
    })
  })

  describe('generic-markdown format', () => {
    it('returns the correct filePath', () => {
      const result = exportForHarness(baseHandoff, 'generic-markdown')
      expect(result.filePath).toBe('AGENT_INSTRUCTIONS.md')
      expect(result.format).toBe('generic-markdown')
    })

    it('includes instructions section', () => {
      const result = exportForHarness(baseHandoff, 'generic-markdown')
      expect(result.content).toContain('## Instructions')
    })

    it('shows placeholder for empty instructions', () => {
      const result = exportForHarness(emptyHandoff, 'generic-markdown')
      expect(result.content).toContain('_No active instruction packs._')
    })

    it('includes policy section', () => {
      const result = exportForHarness(baseHandoff, 'generic-markdown')
      expect(result.content).toContain('## Policy')
      expect(result.content).toContain('Deploy allowed: false')
    })
  })
})

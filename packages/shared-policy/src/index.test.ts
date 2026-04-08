import { describe, expect, it } from 'vitest'
import { PolicyDecisionSchema, PolicyEvaluationSchema } from './index.js'

describe('PolicyDecisionSchema', () => {
  it('parses valid policy decisions', () => {
    expect(PolicyDecisionSchema.parse('allow')).toBe('allow')
    expect(PolicyDecisionSchema.parse('confirm')).toBe('confirm')
    expect(PolicyDecisionSchema.parse('deny')).toBe('deny')
  })
})

describe('PolicyEvaluationSchema', () => {
  it('parses a valid policy evaluation', () => {
    const result = PolicyEvaluationSchema.parse({
      decision: 'confirm',
      reasons: ['regulated projects require human confirmation'],
      approvalRequired: true,
      maxRiskLevel: 'medium',
    })
    expect(result.decision).toBe('confirm')
    expect(result.approvalRequired).toBe(true)
  })
})

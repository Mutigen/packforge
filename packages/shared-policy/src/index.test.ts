import { describe, expect, it } from 'vitest'
import { PolicyDecisionSchema } from './index.js'

describe('PolicyDecisionSchema', () => {
  it('parses a valid policy decision', () => {
    expect(PolicyDecisionSchema.parse({ allowed: true, reason: 'approved' })).toEqual({
      allowed: true,
      reason: 'approved',
    })
  })
})

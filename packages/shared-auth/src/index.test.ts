import { describe, expect, it } from 'vitest'
import { AuthContextSchema } from './index.js'

describe('AuthContextSchema', () => {
  it('defaults roles to an empty array', () => {
    expect(AuthContextSchema.parse({ subject: 'user-1' }).roles).toEqual([])
  })
})

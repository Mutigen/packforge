import { z } from 'zod'

export const AuthContextSchema = z.object({
  subject: z.string().min(1),
  roles: z.array(z.string().min(1)).default([]),
})

export type AuthContext = z.infer<typeof AuthContextSchema>

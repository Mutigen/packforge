import { z } from 'zod'

export const AppEnvironmentSchema = z.enum(['development', 'test', 'production'])
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>

export const BaseConfigSchema = z.object({
  nodeEnv: AppEnvironmentSchema.default('development'),
  logLevel: z.string().default('info'),
})

export type BaseConfig = z.infer<typeof BaseConfigSchema>

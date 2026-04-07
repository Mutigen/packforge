export const Domain = [
  'saas',
  'marketplace',
  'developer-tools',
  'fintech',
  'health',
  'internal-tool',
  'content',
  'ecommerce',
  'open-source',
] as const
export type Domain = (typeof Domain)[number]

export const Phase = ['discovery', 'architecture', 'mvp', 'production', 'scaling', 'maintenance'] as const
export type Phase = (typeof Phase)[number]

export const TaskType = ['build', 'review', 'analyse', 'deploy', 'document', 'debug', 'refactor'] as const
export type TaskType = (typeof TaskType)[number]

export const RiskProfile = ['prototype', 'production', 'regulated'] as const
export type RiskProfile = (typeof RiskProfile)[number]

export const StackSignal = [
  'node',
  'python',
  'go',
  'rust',
  'react',
  'nextjs',
  'vue',
  'svelte',
  'fastify',
  'express',
  'nestjs',
  'hono',
  'postgres',
  'mysql',
  'sqlite',
  'mongodb',
  'prisma',
  'drizzle',
  'typeorm',
  'docker',
  'kubernetes',
  'terraform',
  'openai',
  'anthropic',
  'langchain',
] as const
export type StackSignal = (typeof StackSignal)[number]

export const WorkMode = ['solo', 'team', 'agency', 'open-source'] as const
export type WorkMode = (typeof WorkMode)[number]

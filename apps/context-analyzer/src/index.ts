import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  AnalyzeProjectInputSchema,
  AnalyzerSource,
  MODE_CONFIDENCE_FACTOR,
  ProjectContextSchema,
  type AnalyzeProjectInput,
  type AnalyzerMode,
  type AnalyzerSource as AnalyzerSourceType,
  type Domain,
  type Phase,
  type ProjectContext,
  type RiskProfile,
  type StackSignal,
  type TaskType,
} from '@hub/shared-types'

const PACKAGE_SIGNALS: Record<string, StackSignal[]> = {
  fastify: ['fastify', 'node'],
  express: ['express', 'node'],
  '@nestjs/core': ['nestjs', 'node'],
  next: ['nextjs', 'react', 'node'],
  react: ['react'],
  vue: ['vue'],
  svelte: ['svelte'],
  prisma: ['prisma'],
  'drizzle-orm': ['drizzle'],
  typeorm: ['typeorm'],
  pg: ['postgres'],
  mysql2: ['mysql'],
  mongoose: ['mongodb'],
  openai: ['openai'],
  '@anthropic-ai/sdk': ['anthropic'],
}

type GitNexusMeta = {
  repoPath: string
  indexedAt: string
  stats?: {
    files?: number
    nodes?: number
    edges?: number
    communities?: number
    processes?: number
    embeddings?: number
  }
}

type GitNexusGraphSummary = {
  symbolCount: number
  clusterLabels: string[]
  languages: string[]
  hasProcesses: boolean
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
}

function inferLanguagesFromFiles(files: string[]): string[] {
  const languages = new Set<string>()
  for (const file of files) {
    const ext = path.extname(file)
    const lang = EXTENSION_LANGUAGE_MAP[ext]
    if (lang) languages.add(lang)
  }
  return [...languages]
}

async function readGitNexusGraphSummary(repositoryPath: string): Promise<GitNexusGraphSummary | null> {
  const meta = await readJsonIfExists<GitNexusMeta>(path.join(repositoryPath, '.gitnexus', 'meta.json'))
  if (!meta) return null

  const files = await listRelativeFiles(repositoryPath).catch(() => [] as string[])
  const languages = inferLanguagesFromFiles(files)

  const communityCount = meta.stats?.communities ?? 0
  const clusterLabels = communityCount > 0 ? Array.from({ length: communityCount }, (_, i) => `cluster_${i}`) : []

  return {
    symbolCount: meta.stats?.nodes ?? 0,
    clusterLabels,
    languages,
    hasProcesses: (meta.stats?.processes ?? 0) > 0,
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  const source = await readTextIfExists(filePath)
  if (!source) {
    return null
  }

  return JSON.parse(source) as T
}

async function readYamlIfExists<T>(filePath: string): Promise<T | null> {
  const source = await readTextIfExists(filePath)
  if (!source) {
    return null
  }

  return yaml.load(source) as T
}

async function listRelativeFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        return [] as string[]
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return listRelativeFiles(rootDir, fullPath)
      }

      return [path.relative(rootDir, fullPath)]
    }),
  )

  return nested.flat()
}

function inferTaskType(description: string): TaskType {
  const lowered = description.toLowerCase()
  if (/(deploy|release|ship|infrastructure|ci\/cd)/.test(lowered)) return 'deploy'
  if (/(review|audit|check)/.test(lowered)) return 'review'
  if (/(debug|bug|fix|error|incident)/.test(lowered)) return 'debug'
  if (/(refactor|cleanup|tech debt)/.test(lowered)) return 'refactor'
  if (/(document|docs|write-up|readme)/.test(lowered)) return 'document'
  if (/(analyse|analyze|impact|risk|investigate)/.test(lowered)) return 'analyse'
  return 'build'
}

function inferDomain(description: string, fileList: string[]): Domain {
  const lowered = description.toLowerCase()
  if (/(fintech|payments|billing|invoice)/.test(lowered)) return 'fintech'
  if (/(health|hipaa|patient|medical)/.test(lowered)) return 'health'
  if (/(marketplace)/.test(lowered)) return 'marketplace'
  if (/(shop|ecommerce|storefront)/.test(lowered)) return 'ecommerce'
  if (/(content|blog|media)/.test(lowered)) return 'content'
  if (/(internal|backoffice|ops)/.test(lowered)) return 'internal-tool'
  if (fileList.some((filePath) => filePath.includes('packages/') || filePath.includes('scripts/')))
    return 'developer-tools'
  return 'saas'
}

function inferRiskProfile(description: string, domain: Domain): RiskProfile {
  const lowered = description.toLowerCase()
  if (/(regulated|compliance|gdpr|hipaa|pci|pii)/.test(lowered)) return 'regulated'
  if (domain === 'fintech' || domain === 'health') return 'regulated'
  if (/(production|customers|live|multi-tenant)/.test(lowered)) return 'production'
  return 'prototype'
}

function inferPhase(fileList: string[]): Phase {
  if (fileList.some((filePath) => filePath.startsWith('infra/terraform'))) return 'production'
  if (fileList.some((filePath) => filePath.startsWith('.github/workflows'))) return 'mvp'
  if (fileList.some((filePath) => filePath.startsWith('docs/'))) return 'architecture'
  if (fileList.some((filePath) => filePath === 'CHANGELOG.md')) return 'production'
  return 'discovery'
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

async function inferStackSignals(repositoryPath: string, sources: AnalyzerSourceType[]): Promise<StackSignal[]> {
  const packageJson = await readJsonIfExists<{
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }>(path.join(repositoryPath, 'package.json'))
  const stack: StackSignal[] = []

  if (packageJson) {
    sources.push('package-json')
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }

    for (const dependency of Object.keys(allDeps)) {
      const signals = PACKAGE_SIGNALS[dependency]
      if (signals) {
        stack.push(...signals)
      }
    }
  }

  const dockerfile = await readTextIfExists(path.join(repositoryPath, 'Dockerfile'))
  if (dockerfile) {
    sources.push('dockerfile')
    if (dockerfile.includes('FROM node')) stack.push('node')
    if (dockerfile.includes('FROM python')) stack.push('python')
    if (dockerfile.includes('FROM golang')) stack.push('go')
    stack.push('docker')
  }

  const compose = await readTextIfExists(path.join(repositoryPath, 'docker-compose.yml'))
  if (compose) {
    sources.push('docker-compose')
    if (compose.includes('postgres')) stack.push('postgres')
    if (compose.includes('mysql')) stack.push('mysql')
    if (compose.includes('mongo')) stack.push('mongodb')
    stack.push('docker')
  }

  const workflowsDir = path.join(repositoryPath, '.github', 'workflows')
  try {
    const workflowFiles = await readdir(workflowsDir)
    if (workflowFiles.length > 0) {
      sources.push('github-workflows')
      stack.push('node')
    }
  } catch {
    // ignore
  }

  return unique(stack)
}

async function readGitNexusMeta(
  repositoryPath: string,
): Promise<{ meta: GitNexusMeta | null; staleDays?: number; graphSummary?: GitNexusGraphSummary }> {
  const meta = await readJsonIfExists<GitNexusMeta>(path.join(repositoryPath, '.gitnexus', 'meta.json'))
  if (!meta) {
    return { meta: null }
  }

  const staleDays = Math.max(0, Math.floor((Date.now() - new Date(meta.indexedAt).getTime()) / (1000 * 60 * 60 * 24)))

  const graphSummary = await readGitNexusGraphSummary(repositoryPath)

  return { meta, staleDays, ...(graphSummary ? { graphSummary } : {}) }
}

export function createContextAnalyzer() {
  async function analyzeProjectContext(input: AnalyzeProjectInput): Promise<ProjectContext> {
    const parsed = AnalyzeProjectInputSchema.parse(input)
    const analyzerSources: AnalyzerSourceType[] = []
    const repositoryPath = parsed.repositoryPath ? path.resolve(parsed.repositoryPath) : undefined

    if (!repositoryPath) {
      return ProjectContextSchema.parse({
        projectId: parsed.projectId,
        description: parsed.description,
        stack: [],
        phase: parsed.phase ?? 'discovery',
        domain: parsed.domain ?? 'saas',
        taskType: parsed.taskType ?? inferTaskType(parsed.description),
        riskProfile: parsed.riskProfile ?? 'prototype',
        workMode: parsed.workMode,
        customKeywords: parsed.customKeywords,
        analyzerMode: 'manual',
        analyzerSources: ['user-form'],
        confidenceFactor: MODE_CONFIDENCE_FACTOR.manual,
        analyzedAt: new Date().toISOString(),
        executionTarget: parsed.executionTarget,
        obsidianVaultPath: parsed.obsidianVaultPath,
      })
    }

    const fileList = await listRelativeFiles(repositoryPath)
    analyzerSources.push('filetree-heuristic')

    const readme = await readTextIfExists(path.join(repositoryPath, 'README.md'))
    if (readme) {
      analyzerSources.push('readme-keywords')
    }

    const { meta, staleDays, graphSummary } = await readGitNexusMeta(repositoryPath)
    const analyzerMode: AnalyzerMode = meta ? 'full' : 'fallback'
    if (meta) {
      analyzerSources.push('gitnexus-meta')
    }
    if (graphSummary) {
      analyzerSources.push('gitnexus-graph')
    }

    const description = [parsed.description, readme ?? ''].filter(Boolean).join('\n').trim()
    const stack = await inferStackSignals(repositoryPath, analyzerSources)
    const domain = parsed.domain ?? inferDomain(description, fileList)
    const phase = parsed.phase ?? inferPhase(fileList)
    const taskType = parsed.taskType ?? inferTaskType(description)
    const riskProfile = parsed.riskProfile ?? inferRiskProfile(description, domain)

    return ProjectContextSchema.parse({
      projectId: parsed.projectId,
      description,
      stack,
      phase,
      domain,
      taskType,
      riskProfile,
      workMode: parsed.workMode,
      customKeywords: parsed.customKeywords,
      analyzerMode,
      analyzerSources: unique(analyzerSources),
      confidenceFactor: MODE_CONFIDENCE_FACTOR[analyzerMode],
      analyzedAt: new Date().toISOString(),
      executionTarget: parsed.executionTarget,
      repositoryPath,
      obsidianVaultPath: parsed.obsidianVaultPath,
      gitNexusRepo: meta?.repoPath,
      gitNexusStaleDays: staleDays,
      hasGitNexusIndex: Boolean(meta),
      gitNexusSymbolCount: graphSummary?.symbolCount,
      gitNexusClusters: graphSummary?.clusterLabels ?? [],
    })
  }

  return {
    service: 'context-analyzer',
    status: 'ready',
    analyzeProjectContext,
  }
}

export type ContextAnalyzer = ReturnType<typeof createContextAnalyzer>

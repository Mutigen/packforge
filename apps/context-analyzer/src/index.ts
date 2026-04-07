import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
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
  processLabels: string[]
  languages: string[]
  hasProcesses: boolean
}

/** Lightweight project snapshot written to the MemPalace packforge-cache. */
type PackforgeProjectSnapshot = {
  projectId: string
  repositoryPath?: string
  analyzerMode: AnalyzerMode
  stack: StackSignal[]
  domain: Domain
  phase: Phase
  taskType: TaskType
  riskProfile: RiskProfile
  gitNexusSymbolCount?: number
  gitNexusClusters: string[]
  gitNexusProcessLabels: string[]
  analyzedAt: string
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

function runGitNexusCypher(repoName: string, query: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['gitnexus', 'cypher', '-r', repoName, query],
      { timeout: timeoutMs, maxBuffer: 1024 * 512 },
      (error, stdout) => {
        if (error) return reject(error)
        resolve(stdout)
      },
    )
  })
}

async function queryGitNexusGraphSubprocess(
  repoName: string,
  timeoutMs: number,
): Promise<{
  clusterLabels: string[]
  processLabels: string[]
  symbolCount: number
} | null> {
  try {
    const [clusterResult, processResult, symbolResult] = await Promise.all([
      runGitNexusCypher(repoName, 'MATCH (c:Community) RETURN c.label AS label', timeoutMs).catch(() => null),
      runGitNexusCypher(repoName, 'MATCH (p:Process) RETURN p.label AS label', timeoutMs).catch(() => null),
      runGitNexusCypher(repoName, 'MATCH (n) WHERE n:Function OR n:Method RETURN count(n) AS cnt', timeoutMs).catch(
        () => null,
      ),
    ])

    const parseLabels = (raw: string | null): string[] => {
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw) as { markdown?: string }
        if (!parsed.markdown) return []
        return parsed.markdown
          .split('\n')
          .slice(2) // skip header + separator
          .map((row) =>
            row
              .replace(/^\|\s*/, '')
              .replace(/\s*\|$/, '')
              .trim(),
          )
          .filter(Boolean)
      } catch {
        return []
      }
    }

    const parseCount = (raw: string | null): number => {
      if (!raw) return 0
      try {
        const parsed = JSON.parse(raw) as { markdown?: string }
        if (!parsed.markdown) return 0
        const lines = parsed.markdown.split('\n').slice(2)
        const first = lines[0]
          ?.replace(/^\|\s*/, '')
          .replace(/\s*\|$/, '')
          .trim()
        return first ? parseInt(first, 10) || 0 : 0
      } catch {
        return 0
      }
    }

    const clusterLabels = parseLabels(clusterResult)
    const processLabels = parseLabels(processResult)
    const symbolCount = parseCount(symbolResult)

    if (clusterLabels.length === 0 && processLabels.length === 0 && symbolCount === 0) {
      return null
    }

    return { clusterLabels, processLabels, symbolCount }
  } catch {
    return null
  }
}

async function readGitNexusGraphSummary(
  repositoryPath: string,
  repoName: string | undefined,
  timeoutMs: number,
): Promise<GitNexusGraphSummary | null> {
  const meta = await readJsonIfExists<GitNexusMeta>(path.join(repositoryPath, '.gitnexus', 'meta.json'))
  if (!meta) return null

  const files = await listRelativeFiles(repositoryPath).catch(() => [] as string[])
  const languages = inferLanguagesFromFiles(files)

  // Try subprocess for richer graph data
  const resolvedRepoName = repoName ?? path.basename(repositoryPath)
  const subprocessData = await queryGitNexusGraphSubprocess(resolvedRepoName, timeoutMs)

  if (subprocessData) {
    return {
      symbolCount: subprocessData.symbolCount || (meta.stats?.nodes ?? 0),
      clusterLabels: subprocessData.clusterLabels,
      processLabels: subprocessData.processLabels,
      languages,
      hasProcesses: subprocessData.processLabels.length > 0 || (meta.stats?.processes ?? 0) > 0,
    }
  }

  // Fallback: meta.json only
  const communityCount = meta.stats?.communities ?? 0
  const clusterLabels = communityCount > 0 ? Array.from({ length: communityCount }, (_, i) => `cluster_${i}`) : []

  return {
    symbolCount: meta.stats?.nodes ?? 0,
    clusterLabels,
    processLabels: [],
    languages,
    hasProcesses: (meta.stats?.processes ?? 0) > 0,
  }
}

type MemPalaceSummary = {
  identity: string | null
  wingCount: number
}

type ObsidianDiscovery = {
  vaultPaths: string[]
  projectVaultPath: string | null
}

async function discoverObsidianVaults(projectPath?: string): Promise<ObsidianDiscovery> {
  const vaultPaths: string[] = []
  let projectVaultPath: string | null = null

  // Check if project itself is an Obsidian vault
  if (projectPath) {
    const obsidianDir = path.join(projectPath, '.obsidian')
    try {
      await readdir(obsidianDir)
      projectVaultPath = projectPath
      vaultPaths.push(projectPath)
    } catch {
      // not a vault
    }
  }

  // Read Obsidian app config for registered vaults (macOS)
  const configPath = path.join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  try {
    const configRaw = await readFile(configPath, 'utf8')
    const config = JSON.parse(configRaw) as { vaults?: Record<string, { path?: string }> }
    if (config.vaults) {
      for (const vault of Object.values(config.vaults)) {
        if (vault.path && !vaultPaths.includes(vault.path)) {
          // Verify the vault still exists
          try {
            await readdir(path.join(vault.path, '.obsidian'))
            vaultPaths.push(vault.path)
            if (!projectVaultPath && projectPath && vault.path.startsWith(projectPath)) {
              projectVaultPath = vault.path
            }
          } catch {
            // vault no longer available
          }
        }
      }
    }
  } catch {
    // Obsidian not installed or no config
  }

  // Check common vault locations on Linux
  if (vaultPaths.length === 0) {
    const linuxConfig = path.join(homedir(), '.config', 'obsidian', 'obsidian.json')
    try {
      const configRaw = await readFile(linuxConfig, 'utf8')
      const config = JSON.parse(configRaw) as { vaults?: Record<string, { path?: string }> }
      if (config.vaults) {
        for (const vault of Object.values(config.vaults)) {
          if (vault.path && !vaultPaths.includes(vault.path)) {
            try {
              await readdir(path.join(vault.path, '.obsidian'))
              vaultPaths.push(vault.path)
            } catch {
              // vault no longer available
            }
          }
        }
      }
    } catch {
      // not on Linux or no config
    }
  }

  return { vaultPaths, projectVaultPath }
}

async function readMemPalaceSummary(homedirPath: string): Promise<MemPalaceSummary | null> {
  const palacePath = path.join(homedirPath, '.mempalace', 'palace')
  try {
    await readdir(palacePath)
  } catch {
    return null
  }

  const identity = await readTextIfExists(path.join(homedirPath, '.mempalace', 'identity.txt'))

  let wingCount = 0
  try {
    const entries = await readdir(palacePath, { withFileTypes: true })
    wingCount = entries.filter((e) => e.isDirectory() && e.name.startsWith('wing_')).length
  } catch {
    // ignore
  }

  return { identity: identity?.trim() ?? null, wingCount }
}

/** Sanitize a projectId to a safe filename component. */
function toSafeFileName(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '_')
}

/**
 * Write a lightweight project snapshot to the MemPalace packforge-cache directory
 * (~/.mempalace/packforge-cache/{projectId}.json).  Stored outside the palace/ structure
 * to avoid corrupting MemPalace's internal graph index.
 *
 * Note: the tilde prefix shown in documentation is a shell expansion convention.
 * The actual path is resolved via os.homedir().
 */
async function writeMemPalaceProjectSnapshot(homedirPath: string, snapshot: PackforgeProjectSnapshot): Promise<void> {
  const cacheDir = path.join(homedirPath, '.mempalace', 'packforge-cache')
  await mkdir(cacheDir, { recursive: true })
  const filePath = path.join(cacheDir, `${toSafeFileName(snapshot.projectId)}.json`)
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

/**
 * Read the most recent project snapshot from the MemPalace packforge-cache, if present.
 */
async function readMemPalaceProjectSnapshot(
  homedirPath: string,
  projectId: string,
): Promise<PackforgeProjectSnapshot | null> {
  const filePath = path.join(homedirPath, '.mempalace', 'packforge-cache', `${toSafeFileName(projectId)}.json`)
  return readJsonIfExists<PackforgeProjectSnapshot>(filePath)
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
  timeoutMs: number,
): Promise<{ meta: GitNexusMeta | null; staleDays?: number; graphSummary?: GitNexusGraphSummary }> {
  const meta = await readJsonIfExists<GitNexusMeta>(path.join(repositoryPath, '.gitnexus', 'meta.json'))
  if (!meta) {
    return { meta: null }
  }

  const staleDays = Math.max(0, Math.floor((Date.now() - new Date(meta.indexedAt).getTime()) / (1000 * 60 * 60 * 24)))
  const repoName = path.basename(meta.repoPath ?? repositoryPath)

  const graphSummary = await readGitNexusGraphSummary(repositoryPath, repoName, timeoutMs)

  return { meta, staleDays, ...(graphSummary ? { graphSummary } : {}) }
}

export function createContextAnalyzer(options?: {
  /** Timeout for each GitNexus cypher subprocess call in ms. Defaults to 10 000 ms. */
  gitNexusTimeoutMs?: number
}) {
  const gitNexusTimeoutMs = options?.gitNexusTimeoutMs ?? 10_000

  /**
   * In-process GitNexus graph summary cache.
   * Key: absolute repositoryPath.
   * Value: { staleDays, summary } — invalidated automatically when staleDays changes (index re-analyzed).
   *
   * Avoids the three expensive `npx gitnexus cypher` subprocess calls on every invocation
   * as long as the server process is running and the index hasn't been refreshed.
   */
  const gitNexusGraphCache = new Map<string, { staleDays: number; summary: GitNexusGraphSummary | null }>()

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

    // ─── GitNexus meta + graph summary ───────────────────────────────────────
    const meta = await readJsonIfExists<GitNexusMeta>(path.join(repositoryPath, '.gitnexus', 'meta.json'))
    const analyzerMode: AnalyzerMode = meta ? 'full' : 'fallback'

    let staleDays: number | undefined
    let graphSummary: GitNexusGraphSummary | undefined

    if (meta) {
      analyzerSources.push('gitnexus-meta')
      staleDays = Math.max(0, Math.floor((Date.now() - new Date(meta.indexedAt).getTime()) / (1000 * 60 * 60 * 24)))

      // Use in-process cache when staleDays hasn't changed (index not refreshed)
      const cached = gitNexusGraphCache.get(repositoryPath)
      if (cached && cached.staleDays === staleDays) {
        graphSummary = cached.summary ?? undefined
      } else {
        const repoName = path.basename(meta.repoPath ?? repositoryPath)
        graphSummary = (await readGitNexusGraphSummary(repositoryPath, repoName, gitNexusTimeoutMs)) ?? undefined
        gitNexusGraphCache.set(repositoryPath, { staleDays, summary: graphSummary ?? null })
      }

      if (graphSummary) {
        analyzerSources.push('gitnexus-graph')
      }
    }

    // ─── MemPalace detection ──────────────────────────────────────────────────
    const homedirPath = homedir()
    const mempalace = await readMemPalaceSummary(homedirPath)
    if (mempalace) {
      analyzerSources.push('mempalace-palace')
      if (mempalace.identity) {
        analyzerSources.push('mempalace-identity')
      }
    }

    const obsidian = await discoverObsidianVaults(repositoryPath)
    const resolvedObsidianPath = parsed.obsidianVaultPath ?? obsidian.projectVaultPath ?? obsidian.vaultPaths[0]

    const description = [parsed.description, readme ?? ''].filter(Boolean).join('\n').trim()
    const stack = await inferStackSignals(repositoryPath, analyzerSources)
    const domain = parsed.domain ?? inferDomain(description, fileList)
    const phase = parsed.phase ?? inferPhase(fileList)
    const taskType = parsed.taskType ?? inferTaskType(description)
    const riskProfile = parsed.riskProfile ?? inferRiskProfile(description, domain)

    const context = ProjectContextSchema.parse({
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
      obsidianVaultPath: resolvedObsidianPath,
      gitNexusRepo: meta?.repoPath,
      gitNexusStaleDays: staleDays,
      hasGitNexusIndex: Boolean(meta),
      gitNexusSymbolCount: graphSummary?.symbolCount,
      gitNexusClusters: graphSummary?.clusterLabels ?? [],
      gitNexusProcessLabels: graphSummary?.processLabels ?? [],
      hasMemPalace: Boolean(mempalace),
      ...(mempalace?.identity ? { mempalaceIdentity: mempalace.identity } : {}),
      ...(mempalace ? { mempalaceWingCount: mempalace.wingCount } : {}),
      hasObsidianVault: obsidian.vaultPaths.length > 0,
      obsidianVaults: obsidian.vaultPaths,
    })

    // ─── MemPalace write-through ──────────────────────────────────────────────
    // When MemPalace is installed we persist a lightweight project snapshot to
    // ~/.mempalace/packforge-cache/{projectId}.json so that:
    //   1. Packforge can surface project evolution on subsequent runs.
    //   2. AI agents with MemPalace access can search/retrieve previous
    //      packforge analysis results via mempalace_search or read_file.
    if (mempalace) {
      const snapshot: PackforgeProjectSnapshot = {
        projectId: parsed.projectId,
        ...(repositoryPath ? { repositoryPath } : {}),
        analyzerMode,
        stack,
        domain,
        phase,
        taskType,
        riskProfile,
        ...(graphSummary?.symbolCount !== undefined ? { gitNexusSymbolCount: graphSummary.symbolCount } : {}),
        gitNexusClusters: graphSummary?.clusterLabels ?? [],
        gitNexusProcessLabels: graphSummary?.processLabels ?? [],
        analyzedAt: context.analyzedAt,
      }
      writeMemPalaceProjectSnapshot(homedirPath, snapshot).catch((err) => {
        // Fire-and-forget: write failure must not block the analysis result, but surface for debugging
        if (process.env.NODE_ENV !== 'test') {
          console.warn('[packforge] Failed to write project snapshot to MemPalace cache:', err)
        }
      })
    }

    return context
  }

  /**
   * Read the most recent project snapshot previously written to the MemPalace
   * packforge-cache for a given projectId.  Returns null when MemPalace is not
   * installed or no snapshot exists yet.
   */
  async function getProjectHistory(projectId: string): Promise<PackforgeProjectSnapshot | null> {
    return readMemPalaceProjectSnapshot(homedir(), projectId)
  }

  return {
    service: 'context-analyzer',
    status: 'ready',
    analyzeProjectContext,
    getProjectHistory,
  }
}

export type ContextAnalyzer = ReturnType<typeof createContextAnalyzer>

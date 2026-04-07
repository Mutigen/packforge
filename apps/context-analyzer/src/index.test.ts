import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createContextAnalyzer } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))),
  )
})

describe('createContextAnalyzer', () => {
  it('infers stack and full analyzer mode from repository signals', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'context-analyzer-'))
    tempDirs.push(repoDir)
    await mkdir(path.join(repoDir, '.gitnexus'), { recursive: true })
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ dependencies: { fastify: '^5.0.0', pg: '^8.0.0' } }, null, 2),
    )
    await writeFile(path.join(repoDir, 'README.md'), 'Deploy a SaaS API with customer billing.')
    await writeFile(
      path.join(repoDir, '.gitnexus', 'meta.json'),
      JSON.stringify(
        { repoPath: repoDir, indexedAt: new Date().toISOString(), stats: { clusters: 3, processes: 2 } },
        null,
        2,
      ),
    )

    // Use a very short GitNexus subprocess timeout so the test completes quickly
    // when gitnexus is not installed (subprocess fails fast rather than waiting).
    const analyzer = createContextAnalyzer({ gitNexusTimeoutMs: 500 })
    const context = await analyzer.analyzeProjectContext({
      projectId: 'demo',
      repositoryPath: repoDir,
      description: 'Deploy a SaaS API with customer billing.',
      executionTarget: 'client_workspace',
      customKeywords: [],
    })

    expect(context.analyzerMode).toBe('full')
    expect(context.stack).toEqual(expect.arrayContaining(['fastify', 'postgres', 'node']))
    expect(context.taskType).toBe('deploy')
    expect(context.domain).toBe('fintech')
    expect(context.confidenceFactor).toBe(1)
  }, 10_000)

  it('uses in-process cache for GitNexus graph summary on repeated calls', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'context-analyzer-cache-'))
    tempDirs.push(repoDir)
    await mkdir(path.join(repoDir, '.gitnexus'), { recursive: true })
    await writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }, null, 2))
    const indexedAt = new Date().toISOString()
    await writeFile(
      path.join(repoDir, '.gitnexus', 'meta.json'),
      JSON.stringify({ repoPath: repoDir, indexedAt, stats: { nodes: 10 } }, null, 2),
    )

    const analyzer = createContextAnalyzer({ gitNexusTimeoutMs: 200 })

    const start = Date.now()
    await analyzer.analyzeProjectContext({
      projectId: 'cache-test',
      repositoryPath: repoDir,
      description: 'React app',
      executionTarget: 'client_workspace',
      customKeywords: [],
    })
    const firstElapsed = Date.now() - start

    // Second call should be significantly faster because the GitNexus graph
    // summary is served from the in-process cache (no subprocess spawned).
    const start2 = Date.now()
    await analyzer.analyzeProjectContext({
      projectId: 'cache-test',
      repositoryPath: repoDir,
      description: 'React app',
      executionTarget: 'client_workspace',
      customKeywords: [],
    })
    const secondElapsed = Date.now() - start2

    // Second call must be at least 3× faster than the first
    expect(secondElapsed).toBeLessThan(firstElapsed / 3 + 100)
  }, 15_000)

  it('returns fallback mode when no gitnexus meta exists', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'context-analyzer-fallback-'))
    tempDirs.push(repoDir)
    await writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }, null, 2),
    )

    const analyzer = createContextAnalyzer({ gitNexusTimeoutMs: 200 })
    const context = await analyzer.analyzeProjectContext({
      projectId: 'no-gitnexus',
      repositoryPath: repoDir,
      description: 'A simple Express service',
      executionTarget: 'client_workspace',
      customKeywords: [],
    })

    expect(context.analyzerMode).toBe('fallback')
    expect(context.hasGitNexusIndex).toBe(false)
    expect(context.stack).toContain('express')
  }, 5_000)
})

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

    const analyzer = createContextAnalyzer()
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
  })
})

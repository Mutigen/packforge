import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { createKnowledgeCompiler } from './index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createKnowledgeCompiler', () => {
  it('compiles blueprint notes into runtime packs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-compiler-'))
    const vaultPath = path.join(root, 'vault')
    const outputPath = path.join(root, 'packs')
    tempDirs.push(root)
    await mkdir(vaultPath, { recursive: true })
    await writeFile(
      path.join(vaultPath, 'backend-architect.md'),
      `---
kind: pack-blueprint
id: backend-architect
name: Backend Architect
category: engineering
description: Specialization for backend design decisions.
domain: [saas]
phase: [mvp]
risk_level: low
stack_hints: [node, fastify]
task_types: [build]
risk_profiles: [production]
status: approved
---
# System Prompt
You are a backend architect.

# Constraints
- Be precise

# Tools Allowed
- read_file
`,
    )

    const compiler = createKnowledgeCompiler()
    const report = await compiler.compileVault({ vaultPath, outputPath })
    const compiledPath = path.join(outputPath, 'engineering', 'backend-architect.yaml')
    const compiled = yaml.load(await readFile(compiledPath, 'utf8')) as { instructions: { system_prompt: string } }

    expect(report.compiledPackIds).toContain('backend-architect')
    expect(compiled.instructions.system_prompt).toContain('backend architect')
  })
})

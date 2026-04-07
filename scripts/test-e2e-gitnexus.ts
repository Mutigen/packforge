/**
 * E2E test: verifies the full spec→recommend→confirm flow
 * with and without a GitNexus-indexed repository.
 */

import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createGatewayHandlers } from '../apps/mcp-gateway/src/index.js'

const ROOT = path.resolve(process.cwd())
const PACKS_DIR = path.join(ROOT, 'packs')
const REPO_WITH_GITNEXUS = ROOT

let tempDir: string

async function setup() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'e2e-gitnexus-'))
}

async function teardown() {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FAIL: ${msg}`)
    process.exitCode = 1
  } else {
    console.log(`  PASS: ${msg}`)
  }
}

async function testWithGitNexusRepo() {
  console.log('\n=== Test 1: Repo WITH GitNexus index ===')

  const specPath = path.join(tempDir, 'test-spec.md')
  await writeFile(
    specPath,
    `---
domain: developer-tools
phase: scaling
riskProfile: production
customKeywords:
  - typescript
  - monorepo
  - mcp
---

# MCP Agent Platform

Build and maintain a TypeScript monorepo that orchestrates AI agent instruction packs.
`,
  )

  const memoryFilePath = path.join(tempDir, 'memory-with.json')
  const handlers = createGatewayHandlers({ packsDir: PACKS_DIR, memoryFilePath })

  // Step 1: start_project_from_spec with a repo that has .gitnexus/
  const result = await handlers.startProjectFromSpec({
    specFilePath: specPath,
    repositoryPath: REPO_WITH_GITNEXUS,
  })

  console.log(`  activationId: ${result.activationId}`)
  console.log(`  status: ${result.status}`)
  console.log(`  context.domain: ${result.context.domain}`)
  console.log(`  context.stack: ${JSON.stringify(result.context.stack)}`)
  console.log(`  recommendedPacks (${result.recommendedPacks.length}):`)
  for (const p of result.recommendedPacks) {
    console.log(`    - ${p.packId} (score: ${p.score}) ${p.reasons.join(', ')}`)
  }
  if (result.blockedPacks.length > 0) {
    console.log(`  blockedPacks (${result.blockedPacks.length}):`)
    for (const b of result.blockedPacks) {
      console.log(`    - ${b.packId}: ${b.reason}`)
    }
  }

  assert(result.recommendedPacks.length > 0, 'at least 1 pack recommended')
  assert(result.status === 'pending_confirmation', 'status is pending_confirmation')

  // Check if any GitNexus packs were recommended
  const gnPacks = result.recommendedPacks.filter((p: { packId: string }) => p.packId.startsWith('gitnexus-'))
  console.log(`  GitNexus packs recommended: ${gnPacks.length}`)
  assert(gnPacks.length > 0, 'at least 1 GitNexus pack recommended for indexed repo')

  // Step 2: confirm_activation
  const confirmed = await handlers.confirmActivation({ activationId: result.activationId })
  assert(!('error' in confirmed), 'confirmation succeeded')

  if ('handoff' in confirmed && confirmed.handoff) {
    const handoff = confirmed.handoff as {
      bootstrap: Array<{ id: string; condition: string }>
      instructions: Array<{ packId: string; systemPrompt: string }>
      policy: { approvalRequired: boolean }
    }
    console.log(`  handoff.bootstrap (${handoff.bootstrap.length} steps):`)
    for (const step of handoff.bootstrap) {
      console.log(`    - ${step.id} (${step.condition})`)
    }
    console.log(`  handoff.instructions (${handoff.instructions.length} packs):`)
    for (const inst of handoff.instructions) {
      console.log(`    - ${inst.packId} (prompt length: ${inst.systemPrompt.length})`)
    }

    assert(handoff.instructions.length > 0, 'handoff has instructions')
    assert(
      handoff.instructions.every((i: { systemPrompt: string }) => i.systemPrompt.length > 0),
      'all packs have system prompts',
    )

    // Since repo HAS .gitnexus, there should be NO gitnexus-init bootstrap step
    const gitnexusBootstrap = handoff.bootstrap.find((s: { id: string }) => s.id === 'gitnexus-init')
    assert(!gitnexusBootstrap, 'NO gitnexus-init bootstrap step (index already exists)')
  }

  console.log(`  RESULT: Test 1 complete\n`)
}

async function testWithoutGitNexusRepo() {
  console.log('\n=== Test 2: Repo WITHOUT GitNexus index ===')

  const specPath = path.join(tempDir, 'test-spec-no-gn.md')
  const fakeRepoDir = path.join(tempDir, 'fake-repo')
  await writeFile(
    specPath,
    `---
domain: saas
phase: mvp
riskProfile: prototype
repositoryPath: ${fakeRepoDir}
customKeywords:
  - api
  - backend
---

# New Backend API

Build a new Fastify backend API for a SaaS product.
`,
  )

  // Create a fake repo directory (no .gitnexus/)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(fakeRepoDir, { recursive: true })
  await writeFile(
    path.join(fakeRepoDir, 'package.json'),
    JSON.stringify({
      name: 'fake-api',
      dependencies: { fastify: '^5.0.0', typescript: '^5.0.0' },
    }),
  )
  await writeFile(path.join(fakeRepoDir, 'tsconfig.json'), '{}')

  const memoryFilePath = path.join(tempDir, 'memory-without.json')
  const handlers = createGatewayHandlers({ packsDir: PACKS_DIR, memoryFilePath })

  const result = await handlers.startProjectFromSpec({
    specFilePath: specPath,
  })

  console.log(`  activationId: ${result.activationId}`)
  console.log(`  status: ${result.status}`)
  console.log(`  context.domain: ${result.context.domain}`)
  console.log(`  context.stack: ${JSON.stringify(result.context.stack)}`)
  console.log(`  recommendedPacks (${result.recommendedPacks.length}):`)
  for (const p of result.recommendedPacks) {
    console.log(`    - ${p.packId} (score: ${p.score}) ${p.reasons.join(', ')}`)
  }

  assert(result.recommendedPacks.length > 0, 'at least 1 pack recommended')

  // Check for packforge-cli pack (should be recommended via bootstrap boost)
  const cliPack = result.recommendedPacks.find((p: { packId: string }) => p.packId === 'packforge-cli')
  console.log(`  packforge-cli recommended: ${!!cliPack}${cliPack ? ` (score: ${cliPack.score})` : ''}`)
  assert(!!cliPack, 'packforge-cli recommended for repo without index')

  // Confirm and check bootstrap
  const confirmed = await handlers.confirmActivation({ activationId: result.activationId })
  assert(!('error' in confirmed), 'confirmation succeeded')

  if ('handoff' in confirmed && confirmed.handoff) {
    const handoff = confirmed.handoff as {
      bootstrap: Array<{ id: string; condition: string; command: string }>
      instructions: Array<{ packId: string }>
    }
    console.log(`  handoff.bootstrap (${handoff.bootstrap.length} steps):`)
    for (const step of handoff.bootstrap) {
      console.log(`    - ${step.id} (${step.condition}): ${step.command}`)
    }

    const gitnexusBootstrap = handoff.bootstrap.find((s: { id: string }) => s.id === 'gitnexus-init')
    assert(!!gitnexusBootstrap, 'gitnexus-init bootstrap step present (no index)')
    if (gitnexusBootstrap) {
      assert(gitnexusBootstrap.command.includes('gitnexus'), 'bootstrap command includes gitnexus')
    }
  }

  console.log(`  RESULT: Test 2 complete\n`)
}

// Run
;(async () => {
  try {
    await setup()
    await testWithGitNexusRepo()
    await testWithoutGitNexusRepo()
    console.log(process.exitCode ? '\n❌ Some assertions failed' : '\n✅ All E2E tests passed')
  } catch (err) {
    console.error('E2E test crashed:', err)
    process.exitCode = 1
  } finally {
    await teardown()
  }
})()

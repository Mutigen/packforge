import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'
import {
  CompilerRunReportSchema,
  InstructionPackSchema,
  type CompilerRunReport,
  type ObsidianNoteRef,
  type PackBlueprint,
} from '@hub/shared-types'

type VaultNote = {
  absolutePath: string
  relativePath: string
  title: string
  frontmatter: Record<string, unknown>
  body: string
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!markdown.startsWith('---\n')) {
    return { frontmatter: {}, body: markdown }
  }

  const endIndex = markdown.indexOf('\n---\n', 4)
  if (endIndex === -1) {
    return { frontmatter: {}, body: markdown }
  }

  const rawFrontmatter = markdown.slice(4, endIndex)
  const body = markdown.slice(endIndex + 5)
  return {
    frontmatter: (yaml.load(rawFrontmatter) as Record<string, unknown>) ?? {},
    body,
  }
}

function parseSection(body: string, heading: string): string {
  const pattern = new RegExp(`(?:^|\\n)#+\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n#+\\s+|$)`, 'i')
  const match = body.match(pattern)
  return match?.[1]?.trim() ?? ''
}

function parseListSection(body: string, heading: string): string[] {
  return parseSection(body, heading)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
}

async function listMarkdownFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return listMarkdownFiles(rootDir, fullPath)
      }
      return entry.name.endsWith('.md') ? [fullPath] : []
    }),
  )

  return nested.flat().sort((left, right) => left.localeCompare(right))
}

async function loadVaultNotes(vaultPath: string): Promise<VaultNote[]> {
  const files = await listMarkdownFiles(vaultPath)
  return Promise.all(
    files.map(async (filePath) => {
      const source = await readFile(filePath, 'utf8')
      const { frontmatter, body } = parseFrontmatter(source)
      return {
        absolutePath: filePath,
        relativePath: path.relative(vaultPath, filePath),
        title: path.basename(filePath, '.md'),
        frontmatter,
        body,
      }
    }),
  )
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function toNoteRefs(vaultName: string, refs: string[]): ObsidianNoteRef[] {
  return refs.map((ref) => ({
    vault: vaultName,
    path: ref,
    title: path.basename(ref, '.md'),
    kind: 'pattern',
  }))
}

function buildBlueprint(note: VaultNote, vaultName: string): PackBlueprint {
  const frontmatter = note.frontmatter
  return {
    blueprintId: String(frontmatter.blueprint_id ?? frontmatter.id ?? note.title),
    name: String(frontmatter.name ?? note.title),
    targetPackId: String(frontmatter.target_pack_id ?? frontmatter.id ?? note.title),
    category: String(frontmatter.category ?? 'engineering') as PackBlueprint['category'],
    description: String(frontmatter.description ?? note.title),
    domain: toStringArray(frontmatter.domain) as PackBlueprint['domain'],
    phase: toStringArray(frontmatter.phase) as PackBlueprint['phase'],
    riskLevel: String(frontmatter.risk_level ?? 'low') as PackBlueprint['riskLevel'],
    sourceNotes: toNoteRefs(vaultName, toStringArray(frontmatter.source_notes)),
    stackHints: toStringArray(frontmatter.stack_hints) as PackBlueprint['stackHints'],
    taskTypes: toStringArray(frontmatter.task_types) as PackBlueprint['taskTypes'],
    riskProfiles: toStringArray(frontmatter.risk_profiles) as PackBlueprint['riskProfiles'],
    keywords: toStringArray(frontmatter.keywords),
    compatibleWith: toStringArray(frontmatter.compatible_with),
    conflictsWith: toStringArray(frontmatter.conflicts_with),
    tone: String(frontmatter.tone ?? 'precise') as PackBlueprint['tone'],
    reasoningStyle: String(frontmatter.reasoning_style ?? 'trade-off-first') as PackBlueprint['reasoningStyle'],
    outputFormat: String(frontmatter.output_format ?? 'structured') as PackBlueprint['outputFormat'],
    systemPrompt: parseSection(note.body, 'System Prompt') || note.body.trim(),
    constraints: parseListSection(note.body, 'Constraints'),
    toolsAllowed: parseListSection(note.body, 'Tools Allowed'),
    toolsBlocked: parseListSection(note.body, 'Tools Blocked'),
    status: String(frontmatter.status ?? 'draft') as PackBlueprint['status'],
  }
}

function compileBlueprint(blueprint: PackBlueprint) {
  return InstructionPackSchema.parse({
    id: blueprint.targetPackId,
    version: '1.0.0',
    name: blueprint.name,
    description: blueprint.description,
    category: blueprint.category,
    domain: blueprint.domain,
    phase: blueprint.phase,
    risk_level: blueprint.riskLevel,
    personality: {
      tone: blueprint.tone,
      reasoning_style: blueprint.reasoningStyle,
      output_format: blueprint.outputFormat,
    },
    instructions: {
      system_prompt: blueprint.systemPrompt,
      constraints: blueprint.constraints,
      tools_allowed: blueprint.toolsAllowed,
      tools_blocked: blueprint.toolsBlocked,
    },
    activation_signals: {
      keywords: blueprint.keywords,
      stack_hints: blueprint.stackHints,
      task_types: blueprint.taskTypes,
      domains: blueprint.domain,
      phases: blueprint.phase,
      risk_profiles: blueprint.riskProfiles,
    },
    conflicts_with: blueprint.conflictsWith,
    compatible_with: blueprint.compatibleWith,
    provenance: {
      source_system: 'obsidian-compiler',
      source_refs: blueprint.sourceNotes.map((sourceNote: ObsidianNoteRef) => `${sourceNote.vault}:${sourceNote.path}`),
      compiled_at: new Date().toISOString(),
      compiler_version: '0.1.0',
    },
    approval: {
      state: blueprint.status === 'approved' ? 'approved' : blueprint.status,
    },
    maturity: {
      level: blueprint.status === 'approved' ? 'stable' : 'draft',
    },
    execution_policy: {
      allowed_targets: ['client_workspace', 'sandbox_container'],
      requires_human_confirm: blueprint.riskLevel !== 'low',
    },
  })
}

export function createKnowledgeCompiler() {
  async function compileVault(input: { vaultPath: string; outputPath: string }): Promise<CompilerRunReport> {
    const vaultPath = path.resolve(input.vaultPath)
    const outputPath = path.resolve(input.outputPath)
    const vaultName = path.basename(vaultPath)
    const notes = await loadVaultNotes(vaultPath)
    const blueprintNotes = notes.filter((note) => note.frontmatter.kind === 'pack-blueprint')
    const compiledPackIds: string[] = []
    const warnings: CompilerRunReport['warnings'] = []

    for (const note of blueprintNotes) {
      const blueprint = buildBlueprint(note, vaultName)
      if (!blueprint.systemPrompt) {
        warnings.push({
          code: 'missing-system-prompt',
          message: `Blueprint ${blueprint.targetPackId} has no explicit system prompt section`,
          notePath: note.relativePath,
        })
      }

      const pack = compileBlueprint(blueprint)
      const categoryDir = path.join(outputPath, pack.category)
      await mkdir(categoryDir, { recursive: true })
      const filePath = path.join(categoryDir, `${pack.id}.yaml`)
      await writeFile(filePath, yaml.dump(pack, { noRefs: true, lineWidth: 120 }), 'utf8')
      compiledPackIds.push(pack.id)
    }

    return CompilerRunReportSchema.parse({
      runId: randomUUID(),
      vaultPath,
      outputPath,
      compiledPackIds,
      warnings,
    })
  }

  return {
    service: 'knowledge-compiler',
    status: 'ready',
    compileVault,
  }
}

export type KnowledgeCompiler = ReturnType<typeof createKnowledgeCompiler>

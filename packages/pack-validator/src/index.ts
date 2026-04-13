import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  InstructionPackSchema,
  type InstructionPack,
  type PackDiagnostic,
  type PackRegistryEntry,
} from '@hub/shared-types'

export async function listPackFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        return listPackFiles(entryPath)
      }

      return entry.name.endsWith('.yaml') ? [entryPath] : []
    }),
  )

  return nested.flat().sort((left, right) => left.localeCompare(right))
}

export async function loadPackFile(filePath: string): Promise<unknown> {
  const source = await readFile(filePath, 'utf8')
  return yaml.load(source)
}

export async function validatePackFile(filePath: string): Promise<InstructionPack> {
  const parsed = await loadPackFile(filePath)
  const result = InstructionPackSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid pack ${filePath}: ${issues}`)
  }
  return result.data
}

export type PackCollectionWarning = {
  code: 'asymmetric-compatible-with'
  message: string
  packId: string
  referencedPackId: string
}

export function validatePackCollection(packs: InstructionPack[]): {
  packs: InstructionPack[]
  warnings: PackCollectionWarning[]
} {
  const seenIds = new Set<string>()
  const knownIds = new Set(packs.map((pack) => pack.id))
  const warnings: PackCollectionWarning[] = []
  const compatMap = new Map<string, Set<string>>()

  for (const pack of packs) {
    compatMap.set(pack.id, new Set(pack.compatible_with))
  }

  for (const pack of packs) {
    if (seenIds.has(pack.id)) {
      throw new Error(`Duplicate pack id: ${pack.id}`)
    }
    seenIds.add(pack.id)

    for (const reference of pack.compatible_with) {
      if (!knownIds.has(reference)) {
        throw new Error(`Pack ${pack.id} references unknown compatible_with id ${reference}`)
      }
      if (reference === pack.id) {
        throw new Error(`Pack ${pack.id} cannot reference itself in compatible_with`)
      }
      // Check symmetry: if A lists B as compatible, B should list A
      const otherCompat = compatMap.get(reference)
      if (otherCompat && !otherCompat.has(pack.id)) {
        warnings.push({
          code: 'asymmetric-compatible-with',
          message: `Pack ${pack.id} lists ${reference} as compatible, but ${reference} does not list ${pack.id}`,
          packId: pack.id,
          referencedPackId: reference,
        })
      }
    }

    for (const reference of pack.conflicts_with) {
      if (!knownIds.has(reference)) {
        throw new Error(`Pack ${pack.id} references unknown conflicts_with id ${reference}`)
      }
      if (reference === pack.id) {
        throw new Error(`Pack ${pack.id} cannot reference itself in conflicts_with`)
      }
      if (pack.compatible_with.includes(reference)) {
        throw new Error(`Pack ${pack.id} cannot mark ${reference} as both compatible and conflicting`)
      }
    }
  }

  return { packs, warnings }
}

export async function validatePackDirectory(
  rootDir: string,
): Promise<{ packs: InstructionPack[]; warnings: PackCollectionWarning[]; diagnostics: PackDiagnostic[] }> {
  const files = await listPackFiles(rootDir)
  const diagnostics: PackDiagnostic[] = []

  const results = await Promise.allSettled(files.map((filePath) => validatePackFile(filePath)))

  const packs: InstructionPack[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      packs.push(result.value)
    } else {
      diagnostics.push({
        severity: 'warning',
        tag: 'validation',
        packId: path.basename(files[i]!, '.yaml'),
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  const { warnings } = validatePackCollection(packs)

  return { packs: packs.sort((left, right) => left.id.localeCompare(right.id)), warnings, diagnostics }
}

export function getPackRegistryEntry(pack: InstructionPack, filePath: string): PackRegistryEntry {
  return {
    id: pack.id,
    version: pack.version,
    category: pack.category,
    riskLevel: pack.risk_level,
    maturity: pack.maturity.level,
    approvalState: pack.approval.state,
    filePath: path.normalize(filePath),
    description: pack.description,
  }
}

export function buildPackRegistry(
  packs: InstructionPack[],
  filePathByPackId: Map<string, string>,
): PackRegistryEntry[] {
  validatePackCollection(packs)

  return packs
    .map((pack) => {
      const filePath = filePathByPackId.get(pack.id)
      if (!filePath) {
        throw new Error(`Missing file path for pack ${pack.id}`)
      }

      return getPackRegistryEntry(pack, filePath)
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

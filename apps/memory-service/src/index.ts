import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ActivationPlan, RuntimeHandoffContract } from '@hub/shared-types'

type StoredActivation = {
  id: string
  status: 'pending_confirmation' | 'active' | 'denied'
  createdAt: string
  plan: ActivationPlan
  handoff?: RuntimeHandoffContract
}

type FeedbackEntry = {
  packId: string
  helpful: boolean
  note?: string
  /** Optional project scope — if absent the entry applies globally. */
  projectId?: string
  createdAt: string
}

type MemoryState = {
  activations: StoredActivation[]
  feedback: FeedbackEntry[]
  /** @deprecated Global declined-tool list kept for migration. Prefer declinedToolsByProject. */
  declinedTools: string[]
  /** Per-project declined-tool lists.  Key '*' holds the global (project-agnostic) list. */
  declinedToolsByProject: Record<string, string[]>
}

const DEFAULT_MAX_ACTIVATIONS = 100

function migrateState(raw: Partial<MemoryState>): MemoryState {
  const state: MemoryState = {
    activations: raw.activations ?? [],
    feedback: raw.feedback ?? [],
    declinedTools: raw.declinedTools ?? [],
    declinedToolsByProject: raw.declinedToolsByProject ?? {},
  }

  // One-time migration: move legacy global list into the '*' bucket
  if (state.declinedTools.length > 0 && !state.declinedToolsByProject['*']) {
    state.declinedToolsByProject['*'] = [...state.declinedTools]
  }

  return state
}

/**
 * Read or initialize the memory state from disk.
 *
 * **Concurrency note:** The memory service uses a simple read-modify-write pattern
 * without file-level locking. Concurrent writes from multiple processes or parallel
 * requests can result in lost updates (last-write-wins). This is acceptable for
 * single-process deployments (MCP Gateway, development server) but should be replaced
 * with a proper database or advisory locking for multi-process production use.
 */
async function ensureState(filePath: string): Promise<MemoryState> {
  try {
    const source = await readFile(filePath, 'utf8')
    return migrateState(JSON.parse(source) as Partial<MemoryState>)
  } catch {
    return migrateState({})
  }
}

async function persistState(filePath: string, state: MemoryState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function createMemoryService(options?: { filePath?: string; maxActivations?: number }) {
  const filePath = options?.filePath ?? path.resolve(process.cwd(), '.hub-data', 'memory.json')
  const maxActivations = options?.maxActivations ?? DEFAULT_MAX_ACTIVATIONS

  async function recordActivation(input: {
    id?: string
    status: StoredActivation['status']
    plan: ActivationPlan
    handoff?: RuntimeHandoffContract
  }): Promise<StoredActivation> {
    const state = await ensureState(filePath)
    const activation: StoredActivation = {
      id: input.id ?? randomUUID(),
      status: input.status,
      createdAt: new Date().toISOString(),
      plan: input.plan,
    }

    if (input.handoff) {
      activation.handoff = input.handoff
    }

    state.activations.unshift(activation)

    // Prune oldest activations to prevent unbounded growth
    if (state.activations.length > maxActivations) {
      state.activations = state.activations.slice(0, maxActivations)
    }

    await persistState(filePath, state)
    return activation
  }

  async function getActivation(id: string): Promise<StoredActivation | null> {
    const state = await ensureState(filePath)
    return state.activations.find((activation) => activation.id === id) ?? null
  }

  async function updateActivationStatus(
    id: string,
    status: StoredActivation['status'],
  ): Promise<StoredActivation | null> {
    const state = await ensureState(filePath)
    const activation = state.activations.find((a) => a.id === id)
    if (!activation) return null
    activation.status = status
    await persistState(filePath, state)
    return activation
  }

  async function updateActivationHandoff(
    id: string,
    handoff: RuntimeHandoffContract,
  ): Promise<StoredActivation | null> {
    const state = await ensureState(filePath)
    const activation = state.activations.find((a) => a.id === id)
    if (!activation) return null
    activation.handoff = handoff
    await persistState(filePath, state)
    return activation
  }

  async function listActivations(): Promise<StoredActivation[]> {
    const state = await ensureState(filePath)
    return state.activations
  }

  /**
   * Record user feedback for a pack.
   * @param packId    The pack that was evaluated.
   * @param helpful   Whether the pack was useful.
   * @param note      Optional freeform note.
   * @param projectId Optional project scope — omit for a global (cross-project) entry.
   */
  async function recordFeedback(packId: string, helpful: boolean, note?: string, projectId?: string): Promise<void> {
    const state = await ensureState(filePath)
    const entry: FeedbackEntry = {
      packId,
      helpful,
      createdAt: new Date().toISOString(),
    }
    if (note) entry.note = note
    if (projectId) entry.projectId = projectId

    state.feedback.unshift(entry)
    await persistState(filePath, state)
  }

  /**
   * Compute a net feedback score for every pack, capped at ±5 votes.
   * Positive = helpful entries; negative = not-helpful entries.
   * Project-specific entries take precedence: global entries are only
   * included when no project-specific entries exist for that pack.
   */
  async function getPackFeedbackScores(projectId?: string): Promise<Record<string, number>> {
    const state = await ensureState(filePath)
    const scores: Record<string, number> = {}

    const projectEntries = projectId ? state.feedback.filter((f) => f.projectId === projectId) : []
    const globalEntries = state.feedback.filter((f) => !f.projectId)

    const packsWithProjectFeedback = new Set(projectEntries.map((f) => f.packId))

    const relevant = [...projectEntries, ...globalEntries.filter((f) => !packsWithProjectFeedback.has(f.packId))]

    for (const entry of relevant) {
      scores[entry.packId] = (scores[entry.packId] ?? 0) + (entry.helpful ? 1 : -1)
    }

    // Clamp each score to [-5, +5] so a single rogue entry can't dominate
    for (const packId of Object.keys(scores)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      scores[packId] = Math.max(-5, Math.min(5, scores[packId]!))
    }

    return scores
  }

  /**
   * Decline a tool suggestion so it no longer surfaces in future handoff contracts.
   * @param tool      Tool identifier (e.g. 'gitnexus', 'mempalace').
   * @param projectId Optional project scope — omit to decline globally.
   */
  async function declineToolSuggestion(tool: string, projectId?: string): Promise<void> {
    const state = await ensureState(filePath)
    const bucket = projectId ?? '*'
    if (!state.declinedToolsByProject[bucket]) {
      state.declinedToolsByProject[bucket] = []
    }
    if (!state.declinedToolsByProject[bucket].includes(tool)) {
      state.declinedToolsByProject[bucket].push(tool)
      // Keep legacy list in sync for backward compat
      if (!projectId && !state.declinedTools.includes(tool)) {
        state.declinedTools.push(tool)
      }
      await persistState(filePath, state)
    }
  }

  /**
   * Return declined tools for a given project (union of project-specific and global).
   * @param projectId Optional project scope — omit for the global list only.
   */
  async function getDeclinedTools(projectId?: string): Promise<string[]> {
    const state = await ensureState(filePath)
    const global = state.declinedToolsByProject['*'] ?? []
    if (!projectId) return global

    const projectSpecific = state.declinedToolsByProject[projectId] ?? []
    return [...new Set([...global, ...projectSpecific])]
  }

  return {
    service: 'memory-service',
    status: 'ready',
    filePath,
    maxActivations,
    recordActivation,
    getActivation,
    updateActivationStatus,
    updateActivationHandoff,
    listActivations,
    recordFeedback,
    getPackFeedbackScores,
    declineToolSuggestion,
    getDeclinedTools,
  }
}

export type MemoryService = ReturnType<typeof createMemoryService>

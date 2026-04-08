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

type ListActivationsOptions = {
  /** Filter by project id. */
  projectId?: string
  /** Filter by activation status. */
  status?: StoredActivation['status']
  /** Maximum number of activations to return. */
  limit?: number
  /** Number of activations to skip (for pagination). */
  offset?: number
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

async function readState(filePath: string): Promise<MemoryState> {
  try {
    const source = await readFile(filePath, 'utf8')
    return migrateState(JSON.parse(source) as Partial<MemoryState>)
  } catch {
    return migrateState({})
  }
}

async function writeState(filePath: string, state: MemoryState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Simple async mutex to prevent concurrent read-modify-write cycles on the
 * same JSON file.  All mutating operations acquire the lock before touching
 * the file so that parallel calls are serialised correctly.
 */
function createMutex() {
  let pending: Promise<void> = Promise.resolve()

  return {
    /** Execute `fn` exclusively — only one fn runs at a time. */
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = pending.then(fn, fn)
      // Keep the chain alive but don't propagate rejections into subsequent callers
      pending = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}

export function createMemoryService(options?: { filePath?: string; maxActivations?: number }) {
  const filePath = options?.filePath ?? path.resolve(process.cwd(), '.hub-data', 'memory.json')
  const maxActivations = options?.maxActivations ?? DEFAULT_MAX_ACTIVATIONS
  const mutex = createMutex()

  async function recordActivation(input: {
    id?: string
    status: StoredActivation['status']
    plan: ActivationPlan
    handoff?: RuntimeHandoffContract
  }): Promise<StoredActivation> {
    return mutex.run(async () => {
      const state = await readState(filePath)
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

      await writeState(filePath, state)
      return activation
    })
  }

  async function getActivation(id: string): Promise<StoredActivation | null> {
    const state = await readState(filePath)
    return state.activations.find((activation) => activation.id === id) ?? null
  }

  async function updateActivationStatus(
    id: string,
    status: StoredActivation['status'],
  ): Promise<StoredActivation | null> {
    return mutex.run(async () => {
      const state = await readState(filePath)
      const activation = state.activations.find((a) => a.id === id)
      if (!activation) return null
      activation.status = status
      await writeState(filePath, state)
      return activation
    })
  }

  async function updateActivationHandoff(
    id: string,
    handoff: RuntimeHandoffContract,
  ): Promise<StoredActivation | null> {
    return mutex.run(async () => {
      const state = await readState(filePath)
      const activation = state.activations.find((a) => a.id === id)
      if (!activation) return null
      activation.handoff = handoff
      await writeState(filePath, state)
      return activation
    })
  }

  async function listActivations(opts?: ListActivationsOptions): Promise<StoredActivation[]> {
    const state = await readState(filePath)
    let result = state.activations

    if (opts?.projectId) {
      result = result.filter((a) => a.plan.projectId === opts.projectId)
    }
    if (opts?.status) {
      result = result.filter((a) => a.status === opts.status)
    }

    const offset = opts?.offset ?? 0
    const limit = opts?.limit ?? result.length
    return result.slice(offset, offset + limit)
  }

  /**
   * Record user feedback for a pack.
   * @param packId    The pack that was evaluated.
   * @param helpful   Whether the pack was useful.
   * @param note      Optional freeform note.
   * @param projectId Optional project scope — omit for a global (cross-project) entry.
   */
  async function recordFeedback(packId: string, helpful: boolean, note?: string, projectId?: string): Promise<void> {
    return mutex.run(async () => {
      const state = await readState(filePath)
      const entry: FeedbackEntry = {
        packId,
        helpful,
        createdAt: new Date().toISOString(),
      }
      if (note) entry.note = note
      if (projectId) entry.projectId = projectId

      state.feedback.unshift(entry)
      await writeState(filePath, state)
    })
  }

  /**
   * Compute a net feedback score for every pack, capped at ±5 votes.
   * Positive = helpful entries; negative = not-helpful entries.
   * Project-specific entries take precedence: global entries are only
   * included when no project-specific entries exist for that pack.
   */
  async function getPackFeedbackScores(projectId?: string): Promise<Record<string, number>> {
    const state = await readState(filePath)
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
    return mutex.run(async () => {
      const state = await readState(filePath)
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
        await writeState(filePath, state)
      }
    })
  }

  /**
   * Return declined tools for a given project (union of project-specific and global).
   * @param projectId Optional project scope — omit for the global list only.
   */
  async function getDeclinedTools(projectId?: string): Promise<string[]> {
    const state = await readState(filePath)
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

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

type MemoryState = {
  activations: StoredActivation[]
  feedback: Array<{
    packId: string
    helpful: boolean
    note?: string
    createdAt: string
  }>
}

async function ensureState(filePath: string): Promise<MemoryState> {
  try {
    const source = await readFile(filePath, 'utf8')
    return JSON.parse(source) as MemoryState
  } catch {
    return { activations: [], feedback: [] }
  }
}

async function persistState(filePath: string, state: MemoryState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function createMemoryService(options?: { filePath?: string }) {
  const filePath = options?.filePath ?? path.resolve(process.cwd(), '.hub-data', 'memory.json')

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

  async function listActivations(): Promise<StoredActivation[]> {
    const state = await ensureState(filePath)
    return state.activations
  }

  async function recordFeedback(packId: string, helpful: boolean, note?: string): Promise<void> {
    const state = await ensureState(filePath)
    const feedbackEntry: MemoryState['feedback'][number] = {
      packId,
      helpful,
      createdAt: new Date().toISOString(),
    }

    if (note) {
      feedbackEntry.note = note
    }

    state.feedback.unshift(feedbackEntry)
    await persistState(filePath, state)
  }

  return {
    service: 'memory-service',
    status: 'ready',
    filePath,
    recordActivation,
    getActivation,
    updateActivationStatus,
    listActivations,
    recordFeedback,
  }
}

export type MemoryService = ReturnType<typeof createMemoryService>

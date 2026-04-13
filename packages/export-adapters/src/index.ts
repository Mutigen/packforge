import type { RuntimeHandoffContract, RuntimeInstruction } from '@hub/shared-types'

export type HarnessFormat = 'cursor' | 'claude-code' | 'codex' | 'generic-markdown'

export type ExportResult = {
  format: HarnessFormat
  filePath: string
  content: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatHeader(activationId: string, generatedAt: string): string {
  return `<!-- packforge export — activationId: ${activationId} — generatedAt: ${generatedAt} -->`
}

function mergeSystemPrompts(instructions: RuntimeInstruction[]): string {
  if (instructions.length === 0) return ''
  return instructions.map((i) => i.systemPrompt).join('\n\n---\n\n')
}

function mergeConstraints(instructions: RuntimeInstruction[]): string[] {
  return instructions.flatMap((i) => i.constraints)
}

function mergeToolsAllowed(instructions: RuntimeInstruction[]): string[] {
  const seen = new Set<string>()
  return instructions
    .flatMap((i) => i.toolsAllowed)
    .filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
}

function mergeToolsBlocked(instructions: RuntimeInstruction[]): string[] {
  const seen = new Set<string>()
  return instructions
    .flatMap((i) => i.toolsBlocked)
    .filter((t) => {
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
}

// ---------------------------------------------------------------------------
// Cursor adapter → .cursorrules
// ---------------------------------------------------------------------------

function exportForCursor(handoff: RuntimeHandoffContract): ExportResult {
  const { activationId, instructions, policy, trace } = handoff
  const header = formatHeader(activationId, trace.generatedAt)
  const systemPrompt = mergeSystemPrompts(instructions)
  const constraints = mergeConstraints(instructions)
  const toolsAllowed = mergeToolsAllowed(instructions)
  const toolsBlocked = mergeToolsBlocked(instructions)

  const sections: string[] = [header]

  if (systemPrompt) {
    sections.push(systemPrompt)
  }

  if (constraints.length > 0) {
    sections.push('## Constraints\n' + constraints.map((c) => `- ${c}`).join('\n'))
  }

  const toolLines: string[] = []
  if (toolsAllowed.length > 0) {
    toolLines.push('### Allowed\n' + toolsAllowed.map((t) => `- ${t}`).join('\n'))
  }
  if (toolsBlocked.length > 0) {
    toolLines.push('### Blocked\n' + toolsBlocked.map((t) => `- ${t}`).join('\n'))
  }
  if (toolLines.length > 0) {
    sections.push('## Tools\n' + toolLines.join('\n\n'))
  }

  if (!policy.writeAccess) {
    sections.push('## Policy\n- Write access: disabled')
  }

  return {
    format: 'cursor',
    filePath: '.cursorrules',
    content: sections.join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Claude Code adapter → CLAUDE.md
// ---------------------------------------------------------------------------

function exportForClaudeCode(handoff: RuntimeHandoffContract): ExportResult {
  const { activationId, instructions, policy, trace } = handoff
  const header = formatHeader(activationId, trace.generatedAt)
  const systemPrompt = mergeSystemPrompts(instructions)
  const constraints = mergeConstraints(instructions)
  const toolsBlocked = mergeToolsBlocked(instructions)

  const sections: string[] = [header]

  if (systemPrompt) {
    sections.push(systemPrompt)
  }

  if (constraints.length > 0) {
    const mustAlways = constraints.filter(
      (c) =>
        !c.toLowerCase().startsWith('never') &&
        !c.toLowerCase().startsWith('do not') &&
        !c.toLowerCase().startsWith('no '),
    )
    const mustNever = constraints.filter(
      (c) =>
        c.toLowerCase().startsWith('never') ||
        c.toLowerCase().startsWith('do not') ||
        c.toLowerCase().startsWith('no '),
    )

    const ruleLines: string[] = []
    if (mustAlways.length > 0) {
      ruleLines.push('### Must Always\n' + mustAlways.map((c) => `- ${c}`).join('\n'))
    }
    if (mustNever.length > 0) {
      ruleLines.push('### Must Never\n' + mustNever.map((c) => `- ${c}`).join('\n'))
    }
    sections.push('## Rules\n' + ruleLines.join('\n\n'))
  }

  if (toolsBlocked.length > 0) {
    sections.push('## Blocked Tools\n' + toolsBlocked.map((t) => `- ${t}`).join('\n'))
  }

  if (!policy.deployAllowed) {
    sections.push('## Policy\n- Deployment actions are not allowed in this context.')
  }

  return {
    format: 'claude-code',
    filePath: 'CLAUDE.md',
    content: sections.join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Codex adapter → .codex/instructions.md
// ---------------------------------------------------------------------------

function exportForCodex(handoff: RuntimeHandoffContract): ExportResult {
  const { activationId, instructions, policy, trace } = handoff
  const header = formatHeader(activationId, trace.generatedAt)
  const systemPrompt = mergeSystemPrompts(instructions)
  const constraints = mergeConstraints(instructions)
  const toolsAllowed = mergeToolsAllowed(instructions)
  const toolsBlocked = mergeToolsBlocked(instructions)

  const sections: string[] = [header, '# Agent Instructions']

  if (systemPrompt) {
    sections.push('## System Context\n\n' + systemPrompt)
  }

  if (constraints.length > 0) {
    sections.push('## Constraints\n' + constraints.map((c) => `- ${c}`).join('\n'))
  }

  const toolLines: string[] = []
  if (toolsAllowed.length > 0) {
    toolLines.push('**Allowed:** ' + toolsAllowed.join(', '))
  }
  if (toolsBlocked.length > 0) {
    toolLines.push('**Blocked:** ' + toolsBlocked.join(', '))
  }
  if (toolLines.length > 0) {
    sections.push('## Tool Permissions\n\n' + toolLines.join('\n\n'))
  }

  sections.push(
    `## Policy\n\n- Approval required: ${policy.approvalRequired}\n- Max risk level: ${policy.maxRiskLevel}\n- Write access: ${policy.writeAccess}\n- Network access: ${policy.networkAccess}\n- Deploy allowed: ${policy.deployAllowed}`,
  )

  return {
    format: 'codex',
    filePath: '.codex/instructions.md',
    content: sections.join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Generic Markdown adapter → AGENT_INSTRUCTIONS.md
// ---------------------------------------------------------------------------

function exportForGenericMarkdown(handoff: RuntimeHandoffContract): ExportResult {
  const { activationId, instructions, policy, trace } = handoff
  const header = formatHeader(activationId, trace.generatedAt)
  const systemPrompt = mergeSystemPrompts(instructions)
  const constraints = mergeConstraints(instructions)
  const toolsAllowed = mergeToolsAllowed(instructions)
  const toolsBlocked = mergeToolsBlocked(instructions)

  const sections: string[] = [header, '# Agent Instructions']

  if (systemPrompt) {
    sections.push('## Instructions\n\n' + systemPrompt)
  } else {
    sections.push('## Instructions\n\n_No active instruction packs._')
  }

  if (constraints.length > 0) {
    sections.push('## Constraints\n' + constraints.map((c) => `- ${c}`).join('\n'))
  }

  const toolLines: string[] = []
  if (toolsAllowed.length > 0) {
    toolLines.push('### Allowed\n' + toolsAllowed.map((t) => `- ${t}`).join('\n'))
  }
  if (toolsBlocked.length > 0) {
    toolLines.push('### Blocked\n' + toolsBlocked.map((t) => `- ${t}`).join('\n'))
  }
  if (toolLines.length > 0) {
    sections.push('## Tools\n' + toolLines.join('\n\n'))
  }

  sections.push(
    `## Policy\n\n- Approval required: ${policy.approvalRequired}\n- Max risk level: ${policy.maxRiskLevel}\n- Write access: ${policy.writeAccess}\n- Network access: ${policy.networkAccess}\n- Deploy allowed: ${policy.deployAllowed}`,
  )

  return {
    format: 'generic-markdown',
    filePath: 'AGENT_INSTRUCTIONS.md',
    content: sections.join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export function exportForHarness(handoff: RuntimeHandoffContract, format: HarnessFormat): ExportResult {
  switch (format) {
    case 'cursor':
      return exportForCursor(handoff)
    case 'claude-code':
      return exportForClaudeCode(handoff)
    case 'codex':
      return exportForCodex(handoff)
    case 'generic-markdown':
      return exportForGenericMarkdown(handoff)
    default: {
      const _exhaustive: never = format
      throw new Error(`Unknown harness format: ${String(_exhaustive)}`)
    }
  }
}

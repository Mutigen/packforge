import type { ActivationPlan, InstructionPack, PackDiagnostic, ProjectContext } from '@hub/shared-types'

type PolicyEvaluation = {
  decision: 'allow' | 'confirm' | 'deny'
  reasons: string[]
  diagnostics: PackDiagnostic[]
  approvalRequired: boolean
  maxRiskLevel: 'low' | 'medium' | 'high'
}

const riskOrder = {
  low: 1,
  medium: 2,
  high: 3,
} as const

function getMaxRiskLevel(packs: InstructionPack[]): 'low' | 'medium' | 'high' {
  return packs.reduce<'low' | 'medium' | 'high'>((current, pack) => {
    return riskOrder[pack.risk_level] > riskOrder[current] ? pack.risk_level : current
  }, 'low')
}

export function createPolicyService() {
  function evaluateActivation(ctx: ProjectContext, packs: InstructionPack[]): PolicyEvaluation {
    const diagnostics: PackDiagnostic[] = []

    if (packs.length === 0) {
      return {
        decision: 'deny',
        reasons: ['no packs selected'],
        diagnostics: [
          {
            severity: 'error',
            tag: 'policy-violation',
            packId: '*',
            message: 'no packs selected',
          },
        ],
        approvalRequired: false,
        maxRiskLevel: 'low',
      }
    }

    const reasons: string[] = []
    const maxRiskLevel = getMaxRiskLevel(packs)

    const disallowedTargetPack = packs.find(
      (pack) => !pack.execution_policy.allowed_targets.includes(ctx.executionTarget),
    )
    if (disallowedTargetPack) {
      const message = `pack ${disallowedTargetPack.id} is not allowed on target ${ctx.executionTarget}`
      return {
        decision: 'deny',
        reasons: [message],
        diagnostics: [
          {
            severity: 'error',
            tag: 'policy-violation',
            packId: disallowedTargetPack.id,
            message,
            suggestion: `Add '${ctx.executionTarget}' to the pack's allowed_targets or use a different execution target`,
          },
        ],
        approvalRequired: false,
        maxRiskLevel,
      }
    }

    if (ctx.riskProfile === 'regulated') {
      const message = 'regulated projects require human confirmation'
      reasons.push(message)
      diagnostics.push({
        severity: 'warning',
        tag: 'policy-violation',
        packId: '*',
        message,
      })
    }
    if (ctx.taskType === 'deploy') {
      const message = 'deploy flows require human confirmation'
      reasons.push(message)
      diagnostics.push({
        severity: 'warning',
        tag: 'policy-violation',
        packId: '*',
        message,
      })
    }
    if (maxRiskLevel !== 'low') {
      const message = `pack set contains ${maxRiskLevel} risk instructions`
      reasons.push(message)
      for (const pack of packs) {
        if (pack.risk_level !== 'low') {
          diagnostics.push({
            severity: pack.risk_level === 'high' ? 'warning' : 'info',
            tag: 'policy-violation',
            packId: pack.id,
            message: `${pack.id} has ${pack.risk_level} risk level`,
          })
        }
      }
    }
    if (packs.some((pack) => pack.execution_policy.requires_human_confirm)) {
      const message = 'pack execution policy requires human confirmation'
      reasons.push(message)
      for (const pack of packs) {
        if (pack.execution_policy.requires_human_confirm) {
          diagnostics.push({
            severity: 'info',
            tag: 'policy-violation',
            packId: pack.id,
            message: `${pack.id} requires human confirmation`,
          })
        }
      }
    }

    if (reasons.length > 0) {
      return {
        decision: 'confirm',
        reasons,
        diagnostics,
        approvalRequired: true,
        maxRiskLevel,
      }
    }

    return {
      decision: 'allow',
      reasons: ['pack set approved by default policy'],
      diagnostics,
      approvalRequired: false,
      maxRiskLevel,
    }
  }

  function applyPolicy(plan: ActivationPlan, evaluation: PolicyEvaluation): ActivationPlan {
    return {
      ...plan,
      policyDecision: evaluation.decision,
      policyReasons: evaluation.reasons,
    }
  }

  return {
    service: 'policy-service',
    status: 'ready',
    evaluateActivation,
    applyPolicy,
  }
}

export type PolicyService = ReturnType<typeof createPolicyService>

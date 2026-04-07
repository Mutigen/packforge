import type { ActivationPlan, InstructionPack, ProjectContext } from '@hub/shared-types'

type PolicyEvaluation = {
  decision: 'allow' | 'confirm' | 'deny'
  reasons: string[]
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
    if (packs.length === 0) {
      return {
        decision: 'deny',
        reasons: ['no packs selected'],
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
      return {
        decision: 'deny',
        reasons: [`pack ${disallowedTargetPack.id} is not allowed on target ${ctx.executionTarget}`],
        approvalRequired: false,
        maxRiskLevel,
      }
    }

    if (ctx.riskProfile === 'regulated') {
      reasons.push('regulated projects require human confirmation')
    }
    if (ctx.taskType === 'deploy') {
      reasons.push('deploy flows require human confirmation')
    }
    if (maxRiskLevel !== 'low') {
      reasons.push(`pack set contains ${maxRiskLevel} risk instructions`)
    }
    if (packs.some((pack) => pack.execution_policy.requires_human_confirm)) {
      reasons.push('pack execution policy requires human confirmation')
    }

    if (reasons.length > 0) {
      return {
        decision: 'confirm',
        reasons,
        approvalRequired: true,
        maxRiskLevel,
      }
    }

    return {
      decision: 'allow',
      reasons: ['pack set approved by default policy'],
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

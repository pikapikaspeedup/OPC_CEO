import type { GrowthProposal, OperatingBudgetPolicy } from './contracts';
import { getOrCreateBudgetPolicy } from './budget-policy';

export interface OrganizationAutonomyPolicy {
  budgetPolicy: OperatingBudgetPolicy;
  highRiskApprovalThreshold: number;
}

function normalizeThreshold(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0.7;
  return Math.max(0, Math.min(1, parsed));
}

export function getOrganizationAutonomyPolicy(): OrganizationAutonomyPolicy {
  const budgetPolicy = getOrCreateBudgetPolicy({
    scope: 'organization',
    period: 'day',
  });
  return {
    budgetPolicy,
    highRiskApprovalThreshold: normalizeThreshold(budgetPolicy.metadata?.highRiskApprovalThreshold),
  };
}

export function growthProposalRequiresApproval(
  proposal: GrowthProposal,
  policy: OrganizationAutonomyPolicy = getOrganizationAutonomyPolicy(),
): boolean {
  if (proposal.risk === 'high') return true;
  if (proposal.kind === 'script') return true;
  if (proposal.risk === 'medium') {
    return proposal.score >= Math.round(policy.highRiskApprovalThreshold * 100);
  }
  return false;
}

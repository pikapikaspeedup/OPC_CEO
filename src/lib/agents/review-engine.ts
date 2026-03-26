import type { AgentRunState } from './group-types';
import type { ReviewPolicyAsset, ReviewPolicyRule, ReviewDecisionRule } from './asset-types';
import { createLogger } from '../logger';

const log = createLogger('ReviewEngine');

export class ReviewEngine {
  /**
   * Evaluates a run state against a review policy.
   * Returns the matched outcome, or the fallback decision if no rules match.
   */
  static evaluate(state: AgentRunState, policy: ReviewPolicyAsset): 'approved' | 'revise' | 'rejected' | 'revise-exhausted' {
    for (const rule of policy.rules) {
      if (this.evaluateRuleConditions(state, rule.conditions)) {
        log.info({ runId: state.runId, outcome: rule.outcome }, 'Review rule matched');
        return rule.outcome;
      }
    }

    log.info({ runId: state.runId, fallback: policy.fallbackDecision }, 'No review rules matched, using fallback');
    return policy.fallbackDecision;
  }

  private static evaluateRuleConditions(state: AgentRunState, conditions: ReviewPolicyRule[]): boolean {
    return conditions.every(cond => this.evaluateCondition(state, cond));
  }

  private static evaluateCondition(state: AgentRunState, condition: ReviewPolicyRule): boolean {
    const value = this.extractFieldValue(state, condition.field);

    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'neq':
        return value !== condition.value;
      case 'lt':
        return typeof value === 'number' && value < Number(condition.value);
      case 'gt':
        return typeof value === 'number' && value > Number(condition.value);
      case 'contains':
        if (Array.isArray(value) || typeof value === 'string') {
          return value.includes(condition.value);
        }
        return false;
      default:
        log.warn({ operator: condition.operator }, 'Unknown operator in review policy');
        return false;
    }
  }

  private static extractFieldValue(state: AgentRunState, field: string): any {
    if (field === 'round' || field === 'round_count') {
      return state.currentRound ?? 0;
    }
    if (field === 'artifact.format') {
      return state.resultEnvelope?.outputArtifacts?.map(a => a.format) || [];
    }
    if (field === 'artifact.kind') {
      return state.resultEnvelope?.outputArtifacts?.map(a => a.kind) || [];
    }

    // simplistic nested field resolver: e.g. "resultEnvelope.summary"
    let current: any = state;
    const parts = field.split('.');
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }
}

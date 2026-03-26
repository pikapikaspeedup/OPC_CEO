import type { GroupDefinition } from './group-types';

export interface GroupAsset extends Omit<GroupDefinition, 'id'> {
  id: string;
  kind: 'group';
}

export interface ReviewPolicyRule {
  field: string; // e.g., "round_count", "artifact.format"
  operator: 'eq' | 'neq' | 'lt' | 'gt' | 'contains';
  value: any;
}

export interface ReviewDecisionRule {
  conditions: ReviewPolicyRule[];
  outcome: 'approved' | 'revise' | 'rejected' | 'revise-exhausted';
}

export interface ReviewPolicyAsset {
  id: string;
  kind: 'review-policy';
  description?: string;
  rules: ReviewDecisionRule[];
  fallbackDecision: 'approved' | 'revise' | 'rejected' | 'revise-exhausted';
}

export interface TemplatePackAsset {
  id: string;
  kind: 'template-pack';
  version: string;
  description?: string;
  entrypoints: string[];
}

export type AnyAsset = GroupAsset | ReviewPolicyAsset | TemplatePackAsset;

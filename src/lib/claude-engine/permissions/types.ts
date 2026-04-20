export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'cliArg'
  | 'session';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionRule = {
  source: PermissionRuleSource;
  behavior: PermissionBehavior;
  value: PermissionRuleValue;
};

export type PermissionDecision = {
  behavior: PermissionBehavior | 'passthrough';
  rule?: PermissionRule;
  reason?: string;
};

export const SOURCE_PRIORITY: Record<PermissionRuleSource, number> = {
  cliArg: 5,
  session: 4,
  localSettings: 3,
  projectSettings: 2,
  userSettings: 1,
};
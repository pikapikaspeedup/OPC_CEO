/**
 * Claude Engine Permission 类型定义
 * 精简自 claude-code/src/types/permissions.ts
 */

export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'dontAsk',
  'plan',
  'auto',
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'cliArg'
  | 'session';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionRule = {
  source: PermissionRuleSource;
  ruleBehavior: PermissionBehavior;
  ruleValue: PermissionRuleValue;
};

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'other'; reason: string };

export type PermissionAllowDecision<
  Input extends Record<string, unknown> = Record<string, unknown>,
> = {
  behavior: 'allow';
  updatedInput?: Input;
  decisionReason?: PermissionDecisionReason;
};

export type PermissionAskDecision<
  Input extends Record<string, unknown> = Record<string, unknown>,
> = {
  behavior: 'ask';
  message: string;
  updatedInput?: Input;
  decisionReason?: PermissionDecisionReason;
  suggestions?: PermissionUpdate[];
};

export type PermissionDenyDecision = {
  behavior: 'deny';
  message: string;
  decisionReason: PermissionDecisionReason;
};

export type PermissionDecision<
  Input extends Record<string, unknown> = Record<string, unknown>,
> =
  | PermissionAllowDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionDenyDecision;

export type PermissionResult<
  Input extends Record<string, unknown> = Record<string, unknown>,
> = PermissionDecision<Input>;

export type PermissionUpdateDestination = 'user' | 'project' | 'local';

export type PermissionUpdate = {
  destination: PermissionUpdateDestination;
  rule: PermissionRule;
};

export type PermissionChecker = {
  check(toolName: string, input: Record<string, unknown>): PermissionResult;
  getMode(): PermissionMode;
  setMode(mode: PermissionMode): void;
  addRule(rule: PermissionRule): void;
  getRules(): PermissionRule[];
};

export type WorkingDirectorySource = 'claudemd' | 'cli' | 'config';

export type AdditionalWorkingDirectory = {
  path: string;
  source: WorkingDirectorySource;
};
import type { PermissionMode } from '../types/permissions';
import { classifyToolForAutoMode } from '../security/auto-mode-classifier';
import { mcpToolMatchesRule, parseMcpToolName } from './mcp-matching';
import type {
  PermissionBehavior,
  PermissionDecision,
  PermissionRule,
  PermissionRuleSource,
} from './types';
import { SOURCE_PRIORITY } from './types';

const ACCEPT_EDITS_TOOL_NAMES = new Set([
  'fileedittool',
  'filereadtool',
  'filewritetool',
  'globtool',
  'greptool',
]);

const PLAN_ALLOW_TOOL_NAMES = new Set([
  'filereadtool',
  'globtool',
  'greptool',
]);

const PLAN_DENY_TOOL_NAMES = new Set([
  'bashtool',
  'fileedittool',
  'filewritetool',
]);

const INPUT_CANDIDATE_KEYS = [
  'command',
  'path',
  'file_path',
  'pattern',
  'query',
  'tool_name',
] as const;

export class PermissionChecker {
  private mode: PermissionMode;
  private rules: PermissionRule[];
  private sessionRules: PermissionRule[];
  private cwd?: string;

  constructor(options: {
    mode?: PermissionMode;
    rules?: PermissionRule[];
    cwd?: string;
  } = {}) {
    this.mode = options.mode ?? 'default';
    this.rules = [];
    this.sessionRules = [];
    this.cwd = options.cwd;

    for (const rule of options.rules ?? []) {
      this.addRule(rule);
    }
  }

  check(
    toolName: string,
    input?: Record<string, unknown>,
  ): PermissionDecision {
    const denyRule = this.findMatchingRule(toolName, 'deny', input);

    if (denyRule) {
      return {
        behavior: 'deny',
        rule: denyRule,
        reason: `Denied by ${denyRule.source} rule for ${toolName}`,
      };
    }

    const askRule = this.findMatchingRule(toolName, 'ask', input);

    if (askRule) {
      return this.finalizeAsk(toolName, {
        behavior: 'ask',
        rule: askRule,
        reason: `Permission required by ${askRule.source} rule for ${toolName}`,
      });
    }

    if (this.mode === 'bypassPermissions') {
      return {
        behavior: 'allow',
        reason: 'Allowed by bypassPermissions mode',
      };
    }

    const modeDecision = this.getModeDecision(toolName, input);

    if (modeDecision) {
      return modeDecision;
    }

    const allowRule = this.findMatchingRule(toolName, 'allow', input);

    if (allowRule) {
      return {
        behavior: 'allow',
        rule: allowRule,
        reason: `Allowed by ${allowRule.source} rule for ${toolName}`,
      };
    }

    return this.finalizeAsk(toolName, {
      behavior: 'ask',
      reason: `Permission required for ${toolName}`,
    });
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  addRule(rule: PermissionRule): void {
    const targetRules = rule.source === 'session' ? this.sessionRules : this.rules;
    targetRules.push(cloneRule(rule));
  }

  addSessionRule(toolName: string, behavior: PermissionBehavior): void {
    this.sessionRules.push({
      source: 'session',
      behavior,
      value: { toolName },
    });
  }

  removeRule(source: PermissionRuleSource, toolName: string): boolean {
    const targetRules = source === 'session' ? this.sessionRules : this.rules;
    const ruleIndex = targetRules.findIndex(
      (rule) =>
        rule.source === source &&
        rule.value.toolName === toolName,
    );

    if (ruleIndex === -1) {
      return false;
    }

    targetRules.splice(ruleIndex, 1);
    return true;
  }

  getRules(): PermissionRule[] {
    return [...this.rules, ...this.sessionRules].map(cloneRule);
  }

  isAllowed(toolName: string, input?: Record<string, unknown>): boolean {
    return this.check(toolName, input).behavior === 'allow';
  }

  isDenied(toolName: string, input?: Record<string, unknown>): boolean {
    return this.check(toolName, input).behavior === 'deny';
  }

  private findMatchingRule(
    toolName: string,
    behavior: PermissionBehavior,
    input?: Record<string, unknown>,
  ): PermissionRule | undefined {
    const matchingRules = this.getRules().filter(
      (rule) =>
        rule.behavior === behavior &&
        this.toolMatchesRule(toolName, rule, input),
    );

    if (matchingRules.length === 0) {
      return undefined;
    }

    return matchingRules.sort((leftRule, rightRule) =>
      compareRules(rightRule, leftRule, toolName),
    )[0];
  }

  private toolMatchesRule(
    toolName: string,
    rule: PermissionRule,
    input?: Record<string, unknown>,
  ): boolean {
    const matchesToolName = isToolNameMatch(toolName, rule.value.toolName);

    if (!matchesToolName) {
      return false;
    }

    if (!rule.value.ruleContent) {
      return true;
    }

    return extractInputCandidates(input).some((candidate) =>
      matchesRuleContent(candidate, rule.value.ruleContent as string),
    );
  }

  private finalizeAsk(
    toolName: string,
    decision: PermissionDecision,
  ): PermissionDecision {
    if (this.mode !== 'dontAsk') {
      return decision;
    }

    return {
      behavior: 'deny',
      rule: decision.rule,
      reason: decision.reason
        ? `${decision.reason} (converted by dontAsk mode)`
        : `Permission request for ${toolName} denied by dontAsk mode`,
    };
  }

  private getModeDecision(toolName: string, input?: Record<string, unknown>): PermissionDecision | undefined {
    const normalizedToolName = toolName.toLowerCase();

    if (this.mode === 'acceptEdits') {
      if (ACCEPT_EDITS_TOOL_NAMES.has(normalizedToolName)) {
        return {
          behavior: 'allow',
          reason: 'Allowed by acceptEdits mode',
        };
      }

      return undefined;
    }

    if (this.mode === 'plan') {
      if (PLAN_ALLOW_TOOL_NAMES.has(normalizedToolName)) {
        return {
          behavior: 'allow',
          reason: 'Allowed by plan mode for read-only tool',
        };
      }

      if (PLAN_DENY_TOOL_NAMES.has(normalizedToolName)) {
        return {
          behavior: 'deny',
          reason: 'Denied by plan mode for mutating tool',
        };
      }
    }

    if (this.mode === 'auto') {
      const classification = classifyToolForAutoMode(
        toolName,
        input,
        this.cwd,
      );

      if (!classification.shouldBlock) {
        return {
          behavior: 'allow',
          reason: `Auto-mode: ${classification.reason}`,
        };
      }

      return {
        behavior: 'ask',
        reason: `Auto-mode blocked: ${classification.reason} [${classification.category}]`,
      };
    }

    return undefined;
  }
}

function cloneRule(rule: PermissionRule): PermissionRule {
  return {
    source: rule.source,
    behavior: rule.behavior,
    value: {
      toolName: rule.value.toolName,
      ...(rule.value.ruleContent
        ? { ruleContent: rule.value.ruleContent }
        : {}),
    },
  };
}

function compareRules(
  leftRule: PermissionRule,
  rightRule: PermissionRule,
  toolName: string,
): number {
  const priorityDelta = SOURCE_PRIORITY[leftRule.source] - SOURCE_PRIORITY[rightRule.source];

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return getRuleSpecificity(leftRule, toolName) - getRuleSpecificity(rightRule, toolName);
}

function getRuleSpecificity(rule: PermissionRule, toolName: string): number {
  let specificity = 0;

  if (rule.value.toolName === toolName) {
    specificity += 100;
  }

  if (rule.value.ruleContent) {
    specificity += 1_000 + rule.value.ruleContent.length;
  }

  const parsedRuleToolName = parseMcpToolName(rule.value.toolName);

  if (!parsedRuleToolName) {
    return specificity;
  }

  if (parsedRuleToolName.toolName === undefined || parsedRuleToolName.toolName === '*') {
    return specificity + 10;
  }

  return specificity + 50;
}

function isToolNameMatch(toolName: string, ruleToolName: string): boolean {
  const isMcpRule = parseMcpToolName(ruleToolName) !== null;
  const isMcpTool = parseMcpToolName(toolName) !== null;

  if (isMcpRule || isMcpTool) {
    return mcpToolMatchesRule(toolName, ruleToolName);
  }

  return toolName === ruleToolName;
}

function extractInputCandidates(input?: Record<string, unknown>): string[] {
  if (!input) {
    return [];
  }

  const candidates: string[] = [];

  for (const key of INPUT_CANDIDATE_KEYS) {
    const value = input[key];

    if (typeof value === 'string') {
      candidates.push(value.trim());
    }
  }

  collectStringValues(input, candidates, new Set<object>());

  return [...new Set(candidates.filter(Boolean))];
}

function collectStringValues(
  value: unknown,
  output: string[],
  seen: Set<object>,
): void {
  if (typeof value === 'string') {
    output.push(value.trim());
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output, seen);
    }

    return;
  }

  for (const nestedValue of Object.values(value)) {
    collectStringValues(nestedValue, output, seen);
  }
}

function matchesRuleContent(candidate: string, ruleContent: string): boolean {
  const normalizedCandidate = candidate.trim();
  const normalizedRuleContent = ruleContent.trim();

  if (!normalizedCandidate || !normalizedRuleContent) {
    return false;
  }

  if (!normalizedRuleContent.includes('*')) {
    return normalizedCandidate === normalizedRuleContent;
  }

  const escapedRuleContent = escapeRegExp(normalizedRuleContent).replace(/\\\*/g, '.*');
  return new RegExp(`^${escapedRuleContent}$`).test(normalizedCandidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
import type { PermissionRuleValue } from './types';

export function parseRuleString(ruleString: string): PermissionRuleValue {
  const trimmedRuleString = ruleString.trim();
  const openParenIndex = findFirstUnescapedChar(trimmedRuleString, '(');

  if (openParenIndex === -1) {
    return { toolName: trimmedRuleString };
  }

  const closeParenIndex = findLastUnescapedChar(trimmedRuleString, ')');

  if (
    closeParenIndex === -1 ||
    closeParenIndex <= openParenIndex ||
    closeParenIndex !== trimmedRuleString.length - 1
  ) {
    return { toolName: trimmedRuleString };
  }

  const toolName = trimmedRuleString.slice(0, openParenIndex).trim();
  const rawContent = trimmedRuleString.slice(
    openParenIndex + 1,
    closeParenIndex,
  );

  if (!toolName) {
    return { toolName: trimmedRuleString };
  }

  if (rawContent === '' || rawContent === '*') {
    return { toolName };
  }

  return {
    toolName,
    ruleContent: unescapeRuleContent(rawContent),
  };
}

export function formatRuleValue(value: PermissionRuleValue): string {
  if (!value.ruleContent) {
    return value.toolName;
  }

  return `${value.toolName}(${escapeRuleContent(value.ruleContent)})`;
}

export function escapeRuleContent(content: string): string {
  return content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function unescapeRuleContent(content: string): string {
  return content.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
}

function findFirstUnescapedChar(value: string, targetChar: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== targetChar) {
      continue;
    }

    if (countPrecedingBackslashes(value, index) % 2 === 0) {
      return index;
    }
  }

  return -1;
}

function findLastUnescapedChar(value: string, targetChar: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== targetChar) {
      continue;
    }

    if (countPrecedingBackslashes(value, index) % 2 === 0) {
      return index;
    }
  }

  return -1;
}

function countPrecedingBackslashes(value: string, index: number): number {
  let cursor = index - 1;
  let count = 0;

  while (cursor >= 0 && value[cursor] === '\\') {
    count += 1;
    cursor -= 1;
  }

  return count;
}
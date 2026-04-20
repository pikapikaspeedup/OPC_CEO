import type { ConversationStepErrorMessage } from './types';

export interface ConversationErrorDisplay {
  title: string;
  summary?: string;
  code?: string;
  technicalDetails?: string;
}

function stringifyErrorPart(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map(stringifyErrorPart)
      .filter((item): item is string => Boolean(item));
    return items.length ? items.join('\n') : undefined;
  }

  if (value && typeof value === 'object') {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === '{}' ? undefined : serialized;
  }

  return undefined;
}

function takeFirstUnique(candidates: unknown[], seen: Set<string>): string | undefined {
  for (const candidate of candidates) {
    const text = stringifyErrorPart(candidate);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    return text;
  }

  return undefined;
}

function collectUniqueSections(candidates: unknown[], seen: Set<string>): string | undefined {
  const sections: string[] = [];
  for (const candidate of candidates) {
    const text = stringifyErrorPart(candidate);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    sections.push(text);
  }

  return sections.length ? sections.join('\n\n') : undefined;
}

export function buildConversationErrorDisplay(
  errorMessage?: ConversationStepErrorMessage | null,
): ConversationErrorDisplay {
  const structuredError = errorMessage?.error;
  const seen = new Set<string>();

  const title = takeFirstUnique([
    structuredError?.userErrorMessage,
    errorMessage?.userErrorMessage,
    errorMessage?.message,
    errorMessage?.errorMessage,
    structuredError?.shortError,
    errorMessage?.shortError,
    structuredError?.modelErrorMessage,
    errorMessage?.modelErrorMessage,
    structuredError?.fullError,
    errorMessage?.fullError,
  ], seen) || 'Error occurred';

  const summary = takeFirstUnique([
    structuredError?.shortError,
    errorMessage?.shortError,
    structuredError?.modelErrorMessage,
    errorMessage?.modelErrorMessage,
    structuredError?.userErrorMessage,
    errorMessage?.userErrorMessage,
    errorMessage?.message,
    errorMessage?.errorMessage,
  ], seen);

  const code = stringifyErrorPart(structuredError?.errorCode ?? errorMessage?.errorCode);

  const technicalDetails = collectUniqueSections([
    structuredError?.fullError,
    errorMessage?.fullError,
    structuredError?.details,
    errorMessage?.details,
    structuredError?.rpcErrorDetails,
    errorMessage?.rpcErrorDetails,
  ], seen);

  return {
    title,
    summary,
    code,
    technicalDetails,
  };
}
import en from './messages/en';
import zh from './messages/zh';

export const messages = {
  en,
  zh,
} as const;

export type Locale = keyof typeof messages;
export type Messages = typeof messages.en;

function resolvePath(obj: unknown, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);

  return typeof value === 'string' ? value : undefined;
}

export function getMessage(locale: Locale, key: string): string {
  return resolvePath(messages[locale], key)
    || resolvePath(messages.en, key)
    || key;
}

export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (_, token) => `${values[token] ?? ''}`);
}

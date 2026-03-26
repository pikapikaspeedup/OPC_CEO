import type { Locale } from './index';

export function detectLocale(input?: string | null): Locale {
  if (!input) return 'en';
  return input.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function formatRelativeTime(dateStr: string, locale: Locale): string {
  if (!dateStr) return '';

  const diffSeconds = Math.round((new Date(dateStr).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (Math.abs(diffSeconds) < 60) return rtf.format(diffSeconds, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr));
}

export function formatDateTime(dateStr: string | undefined, locale: Locale): string {
  if (!dateStr) return '';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

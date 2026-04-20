export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
}

export function memoryAge(mtimeMs: number): string {
  const days = memoryAgeDays(mtimeMs);

  if (days === 0) {
    return 'today';
  }

  if (days === 1) {
    return 'yesterday';
  }

  return `${days} days ago`;
}

export function memoryFreshnessNote(mtimeMs: number): string {
  const days = memoryAgeDays(mtimeMs);

  if (days <= 1) {
    return '';
  }

  return `<system-reminder>This memory was last updated ${days} days ago. Verify before relying on it.</system-reminder>`;
}
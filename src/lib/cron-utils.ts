/**
 * 5-field standard cron expression validation.
 * Fields: minute hour day month weekday
 */

const CRON_FIELD_RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const CRON_FIELD_PATTERN = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;

export function validateCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return 'Cron expression is required';
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return `Expected 5 fields, got ${parts.length}`;
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (field === '*') continue;
    if (!CRON_FIELD_PATTERN.test(field)) return `Invalid field ${i + 1}: "${field}"`;
    const nums = field.match(/\d+/g);
    if (nums) {
      const [min, max] = CRON_FIELD_RANGES[i];
      for (const n of nums) {
        const v = parseInt(n, 10);
        if (v < min || v > max) return `Field ${i + 1}: ${v} out of range ${min}-${max}`;
      }
    }
  }
  return null;
}

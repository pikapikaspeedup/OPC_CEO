import { describe, it, expect } from 'vitest';
import { validateCron } from './cron-utils';

describe('validateCron', () => {
  // Valid expressions
  it.each([
    '* * * * *',
    '0 0 * * *',
    '*/5 * * * *',
    '0 9 1 1 0',
    '0,30 * * * *',
    '0 0 1-15 * *',
    '0 0 * * 1-5',
    '0 0 * * 7',
  ])('accepts valid expression "%s"', (expr) => {
    expect(validateCron(expr)).toBeNull();
  });

  // Empty / whitespace
  it('rejects empty string', () => {
    expect(validateCron('')).toBe('Cron expression is required');
  });

  it('rejects whitespace-only', () => {
    expect(validateCron('   ')).toBe('Cron expression is required');
  });

  // Wrong field count
  it('rejects too few fields', () => {
    expect(validateCron('* * *')).toContain('Expected 5 fields, got 3');
  });

  it('rejects too many fields', () => {
    expect(validateCron('* * * * * *')).toContain('Expected 5 fields, got 6');
  });

  // Invalid patterns
  it('rejects invalid characters', () => {
    expect(validateCron('a * * * *')).toContain('Invalid field 1');
  });

  // Numeric range violations
  it('rejects minute > 59', () => {
    expect(validateCron('60 * * * *')).toContain('out of range 0-59');
  });

  it('rejects hour > 23', () => {
    expect(validateCron('0 24 * * *')).toContain('out of range 0-23');
  });

  it('rejects day 0', () => {
    expect(validateCron('0 0 0 * *')).toContain('out of range 1-31');
  });

  it('rejects day > 31', () => {
    expect(validateCron('0 0 32 * *')).toContain('out of range 1-31');
  });

  it('rejects month 0', () => {
    expect(validateCron('0 0 * 0 *')).toContain('out of range 1-12');
  });

  it('rejects month > 12', () => {
    expect(validateCron('0 0 * 13 *')).toContain('out of range 1-12');
  });

  it('rejects weekday > 7', () => {
    expect(validateCron('0 0 * * 8')).toContain('out of range 0-7');
  });

  // Ranges and steps
  it('accepts step notation', () => {
    expect(validateCron('*/10 */2 * * *')).toBeNull();
  });

  it('accepts range notation', () => {
    expect(validateCron('0 9-17 * * 1-5')).toBeNull();
  });

  it('trims whitespace around expression', () => {
    expect(validateCron('  0 0 * * *  ')).toBeNull();
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  getCompanyLoopNotificationTargets,
  sanitizeCompanyLoopNotificationChannels,
} from './company-loop-notification-targets';

const ENV_KEYS = [
  'COMPANY_LOOP_WEBHOOK_URL',
  'AG_COMPANY_LOOP_WEBHOOK_URL',
  'COMPANY_LOOP_EMAIL_WEBHOOK_URL',
  'AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL',
  'COMPANY_LOOP_EMAIL_RECIPIENTS',
  'AG_COMPANY_LOOP_EMAIL_RECIPIENTS',
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
});

describe('company loop notification targets', () => {
  it('keeps web fixed and marks external targets unavailable without config', () => {
    delete process.env.COMPANY_LOOP_WEBHOOK_URL;
    delete process.env.AG_COMPANY_LOOP_WEBHOOK_URL;
    delete process.env.COMPANY_LOOP_EMAIL_WEBHOOK_URL;
    delete process.env.AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL;
    delete process.env.COMPANY_LOOP_EMAIL_RECIPIENTS;
    delete process.env.AG_COMPANY_LOOP_EMAIL_RECIPIENTS;

    const targets = getCompanyLoopNotificationTargets();

    expect(targets).toEqual([
      expect.objectContaining({ channel: 'web', available: true, fixed: true }),
      expect.objectContaining({ channel: 'email', available: false, reason: '未配置邮件网关' }),
      expect.objectContaining({ channel: 'webhook', available: false, reason: '未配置 Webhook URL' }),
    ]);
    expect(sanitizeCompanyLoopNotificationChannels(['web', 'email', 'webhook'])).toEqual(['web']);
  });

  it('only enables email when webhook and recipients are both configured', () => {
    process.env.COMPANY_LOOP_EMAIL_WEBHOOK_URL = 'https://mail.example.test/hook';
    process.env.COMPANY_LOOP_EMAIL_RECIPIENTS = 'ceo@example.test,ops@example.test';
    process.env.COMPANY_LOOP_WEBHOOK_URL = 'https://hooks.example.test/company-loop';

    const targets = getCompanyLoopNotificationTargets();

    expect(targets).toEqual([
      expect.objectContaining({ channel: 'web', available: true, fixed: true }),
      expect.objectContaining({ channel: 'email', available: true, reason: undefined }),
      expect.objectContaining({ channel: 'webhook', available: true, reason: undefined }),
    ]);
    expect(sanitizeCompanyLoopNotificationChannels(['web', 'email', 'webhook'])).toEqual(['web', 'email', 'webhook']);
  });
});

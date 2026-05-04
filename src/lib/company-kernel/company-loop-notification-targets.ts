import type { CompanyLoopNotificationChannel } from './contracts';

export interface CompanyLoopNotificationTargetAvailability {
  channel: CompanyLoopNotificationChannel;
  label: string;
  description: string;
  available: boolean;
  fixed?: boolean;
  reason?: string;
}

function parseEnvList(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getWebhookUrl(): string | null {
  return process.env.COMPANY_LOOP_WEBHOOK_URL
    || process.env.AG_COMPANY_LOOP_WEBHOOK_URL
    || null;
}

function getEmailWebhookUrl(): string | null {
  return process.env.COMPANY_LOOP_EMAIL_WEBHOOK_URL
    || process.env.AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL
    || null;
}

function getEmailRecipients(): string[] {
  return parseEnvList(
    process.env.COMPANY_LOOP_EMAIL_RECIPIENTS
    || process.env.AG_COMPANY_LOOP_EMAIL_RECIPIENTS,
  );
}

export function getCompanyLoopNotificationTargets(): CompanyLoopNotificationTargetAvailability[] {
  const webhookUrl = getWebhookUrl();
  const emailWebhookUrl = getEmailWebhookUrl();
  const emailRecipients = getEmailRecipients();

  return [
    {
      channel: 'web',
      label: 'Web 收件箱',
      description: '在 CEO / Web 界面保留公司循环摘要。',
      available: true,
      fixed: true,
    },
    {
      channel: 'email',
      label: '邮件投递',
      description: '通过外部邮件网关转发公司循环摘要。',
      available: Boolean(emailWebhookUrl && emailRecipients.length > 0),
      reason: emailWebhookUrl
        ? (emailRecipients.length > 0 ? undefined : '未配置收件人')
        : '未配置邮件网关',
    },
    {
      channel: 'webhook',
      label: 'Webhook',
      description: '向外部系统推送公司循环摘要。',
      available: Boolean(webhookUrl),
      reason: webhookUrl ? undefined : '未配置 Webhook URL',
    },
  ];
}

export function isCompanyLoopNotificationChannelAvailable(
  channel: CompanyLoopNotificationChannel,
): boolean {
  return getCompanyLoopNotificationTargets().some((target) => target.channel === channel && target.available);
}

export function sanitizeCompanyLoopNotificationChannels(
  channels: readonly CompanyLoopNotificationChannel[] | null | undefined,
): CompanyLoopNotificationChannel[] {
  const requested = Array.isArray(channels) ? channels : [];
  const next: CompanyLoopNotificationChannel[] = ['web'];

  for (const channel of requested) {
    if (channel === 'web') {
      continue;
    }
    if (isCompanyLoopNotificationChannelAvailable(channel) && !next.includes(channel)) {
      next.push(channel);
    }
  }

  return next;
}

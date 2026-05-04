import { appendCEOEvent } from '../organization/ceo-event-store';
import type { CompanyLoopDigest, CompanyLoopNotificationChannel } from './contracts';
import { sanitizeCompanyLoopNotificationChannels } from './company-loop-notification-targets';

function buildCompanyLoopNotificationMeta(input: {
  digest: CompanyLoopDigest;
  channel: CompanyLoopNotificationChannel;
  deliveryStatus: 'published' | 'queued' | 'not-configured';
  target?: unknown;
}): Record<string, unknown> {
  return {
    digestId: input.digest.id,
    loopRunId: input.digest.loopRunId,
    linkedAgendaIds: input.digest.linkedAgendaIds,
    linkedRunIds: input.digest.linkedRunIds,
    linkedProposalIds: input.digest.linkedProposalIds,
    deliveryChannel: input.channel,
    deliveryStatus: input.deliveryStatus,
    ...(input.target ? { deliveryTarget: input.target } : {}),
  };
}

function appendCompanyLoopNotificationEvent(input: {
  digest: CompanyLoopDigest;
  channel: CompanyLoopNotificationChannel;
  deliveryStatus: 'published' | 'queued' | 'not-configured';
  titleSuffix: string;
  target?: unknown;
}): string {
  const event = appendCEOEvent({
    id: `company-loop:${input.digest.id}:${input.channel}`,
    kind: 'ceo',
    level: input.deliveryStatus === 'not-configured' ? 'warning' : 'info',
    title: `${input.digest.title} · ${input.titleSuffix}`,
    description: input.digest.operatingSummary,
    timestamp: input.digest.createdAt,
    meta: buildCompanyLoopNotificationMeta(input),
  });
  return event.id;
}

function parseListEnv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function enqueueCompanyLoopWebhook(digest: CompanyLoopDigest): string {
  const webhookUrl = process.env.COMPANY_LOOP_WEBHOOK_URL || process.env.AG_COMPANY_LOOP_WEBHOOK_URL;
  const eventId = appendCompanyLoopNotificationEvent({
    digest,
    channel: 'webhook',
    deliveryStatus: webhookUrl ? 'queued' : 'not-configured',
    titleSuffix: 'Webhook',
    ...(webhookUrl ? { target: webhookUrl } : {}),
  });

  if (webhookUrl) {
    void fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'company_loop_digest',
        digest,
      }),
    }).catch((err: unknown) => {
      appendCEOEvent({
        id: `${eventId}:failed:${Date.now()}`,
        kind: 'ceo',
        level: 'warning',
        title: `Company loop webhook failed · ${digest.title}`,
        description: err instanceof Error ? err.message : String(err),
        meta: buildCompanyLoopNotificationMeta({
          digest,
          channel: 'webhook',
          deliveryStatus: 'not-configured',
          target: webhookUrl,
        }),
      });
    });
  }

  return eventId;
}

function enqueueCompanyLoopEmail(digest: CompanyLoopDigest): string {
  const recipients = parseListEnv(process.env.COMPANY_LOOP_EMAIL_RECIPIENTS || process.env.AG_COMPANY_LOOP_EMAIL_RECIPIENTS);
  const emailWebhookUrl = process.env.COMPANY_LOOP_EMAIL_WEBHOOK_URL || process.env.AG_COMPANY_LOOP_EMAIL_WEBHOOK_URL;
  const eventId = appendCompanyLoopNotificationEvent({
    digest,
    channel: 'email',
    deliveryStatus: emailWebhookUrl ? 'queued' : 'not-configured',
    titleSuffix: 'Email',
    ...(emailWebhookUrl ? { target: { url: emailWebhookUrl, recipients } } : {}),
  });

  if (emailWebhookUrl) {
    void fetch(emailWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'company_loop_digest_email',
        recipients,
        digest,
      }),
    }).catch((err: unknown) => {
      appendCEOEvent({
        id: `${eventId}:failed:${Date.now()}`,
        kind: 'ceo',
        level: 'warning',
        title: `Company loop email delivery failed · ${digest.title}`,
        description: err instanceof Error ? err.message : String(err),
        meta: buildCompanyLoopNotificationMeta({
          digest,
          channel: 'email',
          deliveryStatus: 'not-configured',
          target: { url: emailWebhookUrl, recipients },
        }),
      });
    });
  }

  return eventId;
}

export function notifyCompanyLoopDigest(input: {
  digest: CompanyLoopDigest;
  channels: CompanyLoopNotificationChannel[];
}): string[] {
  return sanitizeCompanyLoopNotificationChannels(input.channels).map((channel) => {
    if (channel === 'web') {
      return appendCompanyLoopNotificationEvent({
        digest: input.digest,
        channel,
        deliveryStatus: 'published',
        titleSuffix: 'Web',
      });
    }
    if (channel === 'webhook') {
      return enqueueCompanyLoopWebhook(input.digest);
    }
    return enqueueCompanyLoopEmail(input.digest);
  });
}

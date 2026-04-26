import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;
let previousWebhookUrl: string | undefined;
let previousWebhookSecret: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  delete (globalThis as Record<string, unknown>).__AG_APPROVAL_NOTIFICATION_LISTENERS__;
  delete (globalThis as Record<string, unknown>).__AG_APPROVAL_NOTIFICATION_RECENT__;
  delete (globalThis as Record<string, unknown>).__AG_APPROVAL_NOTIFICATION_SEQ__;
  return {
    handler: await import('../handler'),
    requestStore: await import('../request-store'),
    events: await import('../notification-events'),
    webhook: await import('../channels/webhook'),
  };
}

describe('approval notifications', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-notifications-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    previousWebhookUrl = process.env.APPROVAL_WEBHOOK_URL;
    previousWebhookSecret = process.env.APPROVAL_WEBHOOK_SECRET;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    delete process.env.APPROVAL_WEBHOOK_URL;
    delete process.env.APPROVAL_WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    if (previousWebhookUrl === undefined) delete process.env.APPROVAL_WEBHOOK_URL;
    else process.env.APPROVAL_WEBHOOK_URL = previousWebhookUrl;
    if (previousWebhookSecret === undefined) delete process.env.APPROVAL_WEBHOOK_SECRET;
    else process.env.APPROVAL_WEBHOOK_SECRET = previousWebhookSecret;
    vi.unstubAllGlobals();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('publishes web events and persists delivery records when an approval is submitted', async () => {
    const { handler, requestStore, events } = await loadModules();
    handler.setApprovalConfig({ gatewayUrl: 'http://127.0.0.1:3000' });

    const received: string[] = [];
    const unsubscribe = events.subscribeApprovalNotificationEvents((event) => {
      received.push(event.type);
    });

    const request = await handler.submitApprovalRequest({
      type: 'proposal_publish',
      workspace: 'file:///tmp/research',
      title: '发布提案',
      description: '需要 CEO 审批',
    });

    unsubscribe();
    expect(received).toEqual(['approval_request']);
    expect(request.notifications).toEqual([
      expect.objectContaining({ channel: 'web', success: true }),
    ]);
    expect(requestStore.getApprovalRequest(request.id)?.notifications).toEqual([
      expect.objectContaining({ channel: 'web', success: true }),
    ]);
  });

  it('publishes approval response events after CEO responds', async () => {
    const { handler, events } = await loadModules();
    handler.setApprovalConfig({ gatewayUrl: 'http://127.0.0.1:3000' });

    const request = await handler.submitApprovalRequest({
      type: 'proposal_publish',
      workspace: 'file:///tmp/research',
      title: '发布提案',
      description: '需要 CEO 审批',
    });

    const received: string[] = [];
    const unsubscribe = events.subscribeApprovalNotificationEvents((event) => {
      received.push(event.type);
    });

    await handler.handleApprovalResponse(request.id, 'approved', 'ok');
    unsubscribe();
    expect(received).toEqual(['approval_response']);
  });

  it('posts webhook payloads with HMAC signatures', async () => {
    const { webhook } = await loadModules();
    const channel = new webhook.WebhookChannel('http://127.0.0.1:3000');
    channel.addEndpoint({
      id: 'test-hook',
      url: 'https://example.test/webhook',
      secret: 'secret',
      enabled: true,
    });

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await channel.send({
      id: 'approval-1',
      type: 'proposal_publish',
      workspace: 'file:///tmp/research',
      title: '发布提案',
      description: '需要 CEO 审批',
      urgency: 'normal',
      status: 'pending',
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      notifications: [],
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Signature-256': expect.stringMatching(/^sha256=/),
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, string>;
    expect(body.approveUrl).toContain('/api/approval/approval-1/feedback?action=approve&token=');
    expect(body.rejectUrl).toContain('/api/approval/approval-1/feedback?action=reject&token=');
  });
});

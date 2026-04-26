/**
 * Notification Channels — Type re-exports and registration.
 *
 * Each channel implements the `NotificationChannel` interface.
 * Channels are registered here and looked up by the Dispatcher.
 */

export { WebChannel } from './web';
export { IMChannel } from './im';
export { WebhookChannel } from './webhook';

import type { NotificationChannel } from '../types';
import { WebChannel } from './web';
import { IMChannel } from './im';
import { WebhookChannel, slackTransform } from './webhook';

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

const registry = new Map<string, NotificationChannel>();
let defaultGatewayUrl: string | null = null;

/** Register a channel (called at startup). */
export function registerChannel(channel: NotificationChannel): void {
  registry.set(channel.id, channel);
}

/** Get a channel by ID. */
export function getChannel(id: string): NotificationChannel | undefined {
  return registry.get(id);
}

/** Get all registered channels. */
export function getAllChannels(): NotificationChannel[] {
  return Array.from(registry.values());
}

/** Get all enabled channels. */
export function getEnabledChannels(channelIds?: string[]): NotificationChannel[] {
  const allowed = channelIds?.length ? new Set(channelIds) : null;
  return Array.from(registry.values()).filter(ch => ch.enabled && (!allowed || allowed.has(ch.id)));
}

function addEnvWebhookEndpoint(channel: WebhookChannel): void {
  const url = process.env.APPROVAL_WEBHOOK_URL;
  if (!url) return;

  channel.addEndpoint({
    id: process.env.APPROVAL_WEBHOOK_ID || 'default',
    url,
    secret: process.env.APPROVAL_WEBHOOK_SECRET,
    enabled: process.env.APPROVAL_WEBHOOK_ENABLED !== '0',
    transform: process.env.APPROVAL_WEBHOOK_FORMAT === 'slack' ? slackTransform : undefined,
  });
}

/**
 * Initialize default channels.
 * Called once at gateway startup.
 *
 * @param gatewayUrl — Base URL for generating approval links.
 */
export function initDefaultChannels(gatewayUrl: string): void {
  defaultGatewayUrl = gatewayUrl;
  if (!getChannel('web')) {
    registerChannel(new WebChannel(gatewayUrl));
  }
  if (!getChannel('cc-connect')) {
    registerChannel(new IMChannel(gatewayUrl));
  }
  if (!getChannel('webhook')) {
    const webhook = new WebhookChannel(gatewayUrl);
    addEnvWebhookEndpoint(webhook);
    registerChannel(webhook);
  }
}

export function ensureDefaultChannels(gatewayUrl: string): void {
  if (registry.size > 0 && defaultGatewayUrl === gatewayUrl) return;
  registry.clear();
  initDefaultChannels(gatewayUrl);
}

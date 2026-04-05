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
import { WebhookChannel } from './webhook';

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

const registry = new Map<string, NotificationChannel>();

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
export function getEnabledChannels(): NotificationChannel[] {
  return Array.from(registry.values()).filter(ch => ch.enabled);
}

/**
 * Initialize default channels.
 * Called once at gateway startup.
 *
 * @param gatewayUrl — Base URL for generating approval links.
 */
export function initDefaultChannels(gatewayUrl: string): void {
  registerChannel(new WebChannel(gatewayUrl));
  registerChannel(new IMChannel(gatewayUrl));
  registerChannel(new WebhookChannel(gatewayUrl));
}

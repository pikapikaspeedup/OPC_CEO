/**
 * Antigravity Obsidian Plugin — Main entry point.
 *
 * Registers a right-sidebar Chat View for conversing with
 * the Antigravity Gateway server directly inside Obsidian.
 * Initialises the structured logger and exports debug logs command.
 */

import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ChatView, VIEW_TYPE_CHAT } from './chat-view';
import { GatewayClient } from './api-client';
import { AntigravitySettingTab, DEFAULT_SETTINGS, type AntigravitySettings } from './settings';
import { logger, type LogLevel } from './logger';

export default class AntigravityPlugin extends Plugin {
  settings!: AntigravitySettings;
  client!: GatewayClient;

  async onload() {
    await this.loadSettings();

    // Configure logger from settings
    logger.setLevel((this.settings.logLevel || 'INFO') as LogLevel);
    logger.info('Plugin', 'Plugin loading', { version: this.manifest.version });

    this.client = new GatewayClient(this.settings.gatewayUrl);

    // Register the chat view
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to open chat
    this.addRibbonIcon('bot', 'Open Google Antigravity Chat', () => {
      this.activateView();
    });

    // Add command: open chat
    this.addCommand({
      id: 'open-chat',
      name: 'Open Google Antigravity Chat',
      callback: () => this.activateView(),
    });

    // Add command: export debug logs
    this.addCommand({
      id: 'export-debug-logs',
      name: 'Export Debug Logs (Copy to Clipboard)',
      callback: async () => {
        const text = logger.exportAsText();
        await navigator.clipboard.writeText(text);
        new Notice(`Debug logs copied to clipboard (${logger.getEntries().length} entries)`);
        logger.info('Plugin', 'Debug logs exported to clipboard');
      },
    });

    // Add command: clear logs
    this.addCommand({
      id: 'clear-debug-logs',
      name: 'Clear Debug Logs',
      callback: () => {
        logger.clear();
        new Notice('Debug logs cleared');
      },
    });

    // Add settings tab
    this.addSettingTab(new AntigravitySettingTab(this.app, this));

    // Auto-open on the right if not already open
    this.app.workspace.onLayoutReady(() => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
      if (leaves.length === 0) {
        this.activateView();
      }
    });

    logger.info('Plugin', 'Plugin loaded successfully');
  }

  async onunload() {
    logger.info('Plugin', 'Plugin unloading');
    this.client.disconnectWs();
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

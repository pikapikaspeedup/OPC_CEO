/**
 * Antigravity Plugin Settings
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type AntigravityPlugin from './main';
import { logger, type LogLevel } from './logger';

const LOG_SRC = 'Settings';

export interface AntigravitySettings {
  gatewayUrl: string;
  workspaceUri: string; // Explicit workspace URI override (empty = auto-detect from vault path)
  logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: AntigravitySettings = {
  gatewayUrl: 'http://localhost:3000',
  workspaceUri: '',
  logLevel: 'INFO',
};

export class AntigravitySettingTab extends PluginSettingTab {
  plugin: AntigravityPlugin;

  constructor(app: App, plugin: AntigravityPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Antigravity Settings' });

    // ── Gateway URL ──
    const gatewaySetting = new Setting(containerEl)
      .setName('Gateway URL')
      .setDesc('The URL of your Antigravity Gateway server.');

    // Connection status indicator (inline)
    const statusEl = gatewaySetting.descEl.createSpan({ cls: 'ag-setting-status' });

    gatewaySetting.addText((text) =>
      text
        .setPlaceholder('http://localhost:3000')
        .setValue(this.plugin.settings.gatewayUrl)
        .onChange(async (value) => {
          this.plugin.settings.gatewayUrl = value;
          this.plugin.client.setBaseUrl(value);
          await this.plugin.saveSettings();
          logger.info(LOG_SRC, 'Gateway URL updated', { url: value });
        }),
    );

    // Test Connection button
    gatewaySetting.addButton((btn) =>
      btn
        .setButtonText('Test')
        .setCta()
        .onClick(async () => {
          statusEl.empty();
          statusEl.textContent = ' Testing...';
          statusEl.className = 'ag-setting-status ag-setting-testing';

          const reachable = await this.plugin.client.ping();
          statusEl.empty();

          if (reachable) {
            statusEl.textContent = ' ✅ Connected';
            statusEl.className = 'ag-setting-status ag-setting-connected';
            logger.info(LOG_SRC, 'Connection test: OK');
          } else {
            statusEl.textContent = ' ❌ Unreachable';
            statusEl.className = 'ag-setting-status ag-setting-failed';
            logger.warn(LOG_SRC, 'Connection test: FAILED');
          }
        }),
    );

    // ── Workspace selector ──
    const wsSetting = new Setting(containerEl)
      .setName('Workspace')
      .setDesc('The Antigravity workspace this vault is associated with. Auto-detected if matching.');

    const wsDropdown = wsSetting.controlEl.createEl('select', { cls: 'dropdown' });
    wsDropdown.createEl('option', { value: '', text: 'Auto-detect from vault path' });

    this.loadWorkspaceOptions(wsDropdown);

    wsDropdown.value = this.plugin.settings.workspaceUri;
    wsDropdown.addEventListener('change', async () => {
      this.plugin.settings.workspaceUri = wsDropdown.value;
      await this.plugin.saveSettings();
      logger.info(LOG_SRC, 'Workspace updated', { workspace: wsDropdown.value || 'auto-detect' });
    });

    // ── Log Level ──
    new Setting(containerEl)
      .setName('Log Level')
      .setDesc('Minimum log level for debug output. Lower levels record more detail for troubleshooting.')
      .addDropdown((dd) =>
        dd
          .addOptions({
            DEBUG: 'DEBUG — Verbose (all details)',
            INFO: 'INFO — Standard',
            WARN: 'WARN — Warnings & errors only',
            ERROR: 'ERROR — Errors only',
          })
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (value) => {
            this.plugin.settings.logLevel = value as LogLevel;
            logger.setLevel(value as LogLevel);
            await this.plugin.saveSettings();
            logger.info(LOG_SRC, `Log level changed to ${value}`);
            new Notice(`Log level set to ${value}`);
          }),
      );

    // ── Debug Actions ──
    new Setting(containerEl)
      .setName('Export Debug Logs')
      .setDesc(`Copy ${logger.getEntries().length} log entries to clipboard for troubleshooting.`)
      .addButton((btn) =>
        btn
          .setButtonText('Copy Logs')
          .onClick(async () => {
            const text = logger.exportAsText();
            await navigator.clipboard.writeText(text);
            new Notice(`Debug logs copied (${logger.getEntries().length} entries)`);
          }),
      );
  }

  private async loadWorkspaceOptions(dropdown: HTMLSelectElement) {
    try {
      const servers = await this.plugin.client.getServers();
      for (const s of servers) {
        const ws = s.workspace || `file://localhost:${s.port}`;
        dropdown.createEl('option', { value: ws, text: ws.replace('file://', '') });
      }
      if (this.plugin.settings.workspaceUri) {
        dropdown.value = this.plugin.settings.workspaceUri;
      }
    } catch {
      logger.debug(LOG_SRC, 'Could not load workspace options (gateway not running)');
    }
  }
}

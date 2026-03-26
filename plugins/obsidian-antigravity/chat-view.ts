/**
 * Antigravity Chat View — Right sidebar panel for Obsidian.
 *
 * Renders a chat interface that talks to the Gateway server.
 * Features: conversation list, message display, input box, real-time streaming,
 *           disconnect banner, heartbeat health check, structured logging.
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon } from 'obsidian';
import type AntigravityPlugin from './main';
import type { Conversation, Step, StepsData, ModelConfig, WsConnectionState } from './api-client';
import { logger } from './logger';

const LOG_SRC = 'ChatView';

export const VIEW_TYPE_CHAT = 'antigravity-chat';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

export class ChatView extends ItemView {
  plugin: AntigravityPlugin;
  private currentCascadeId: string | null = null;
  private steps: Step[] = [];
  private isStreaming = false;
  private agenticMode = true; // true = Planning, false = Fast
  private currentModel = 'MODEL_AUTO';
  private models: ModelConfig[] = [];

  // DOM refs
  private headerEl!: HTMLElement;
  private disconnectBannerEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputContainerEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtnEl!: HTMLButtonElement;
  private conversationListEl!: HTMLElement;
  private showingConversationList = true;
  private gatewayConnected = false;
  private isCheckingGateway = false;

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // WS state listener reference (for cleanup)
  private wsStateListener: ((state: WsConnectionState, detail?: string) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AntigravityPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return 'Google Antigravity';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen() {
    logger.info(LOG_SRC, 'Chat view opened');
    const container = this.contentEl;
    container.empty();
    container.addClass('antigravity-chat-root');

    // Header
    this.headerEl = container.createDiv({ cls: 'ag-header' });
    this.renderHeader();

    // Disconnect banner (hidden by default)
    this.disconnectBannerEl = container.createDiv({ cls: 'ag-disconnect-banner' });
    this.disconnectBannerEl.hide();

    // Conversation List (initial view)
    this.conversationListEl = container.createDiv({ cls: 'ag-conversation-list' });

    // Messages area
    this.messagesEl = container.createDiv({ cls: 'ag-messages' });
    this.messagesEl.hide();

    // Input area
    this.inputContainerEl = container.createDiv({ cls: 'ag-input-container' });
    this.inputContainerEl.hide();
    this.renderInput();

    // Listen to WebSocket state changes
    this.wsStateListener = (state, detail) => this.onWsStateChange(state, detail);
    this.plugin.client.onWsStateChange(this.wsStateListener);

    // Check gateway, then load data
    await this.checkGateway();

    // Start heartbeat
    this.startHeartbeat();
  }

  async onClose() {
    logger.info(LOG_SRC, 'Chat view closed');
    if (this.currentCascadeId) {
      this.plugin.client.unsubscribe(this.currentCascadeId);
    }
    // Remove WS state listener
    if (this.wsStateListener) {
      this.plugin.client.removeWsStateListener(this.wsStateListener);
      this.wsStateListener = null;
    }
    this.stopHeartbeat();
  }

  // ── Heartbeat ──

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeatCheck(), HEARTBEAT_INTERVAL_MS);
    logger.debug(LOG_SRC, 'Heartbeat started', { intervalMs: HEARTBEAT_INTERVAL_MS });
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async heartbeatCheck() {
    const reachable = await this.plugin.client.ping();
    const wasConnected = this.gatewayConnected;
    this.gatewayConnected = reachable;

    if (wasConnected && !reachable) {
      logger.warn(LOG_SRC, 'Heartbeat: Gateway became unreachable');
      this.renderHeader();
      this.showDisconnectBanner('Gateway connection lost. Retrying...');
    } else if (!wasConnected && reachable) {
      logger.info(LOG_SRC, 'Heartbeat: Gateway recovered');
      this.renderHeader();
      this.hideDisconnectBanner();
      // Reload data after recovery
      if (this.showingConversationList) {
        this.loadConversations();
      }
    }
  }

  // ── WebSocket state handling ──

  private onWsStateChange(state: WsConnectionState, detail?: string) {
    logger.debug(LOG_SRC, `WS state changed: ${state}`, detail);

    switch (state) {
      case 'connected':
        this.hideDisconnectBanner();
        break;
      case 'reconnecting':
        this.showDisconnectBanner(`Reconnecting to server... (${detail || ''})`);
        break;
      case 'disconnected':
        if (detail === 'max retries exceeded') {
          this.showDisconnectBanner(
            'Connection lost. Auto-reconnect failed.',
            true, // show manual reconnect button
          );
        }
        break;
    }
  }

  // ── Disconnect Banner ──

  private showDisconnectBanner(message: string, showReconnectBtn = false) {
    this.disconnectBannerEl.empty();

    const iconEl = this.disconnectBannerEl.createSpan({ cls: 'ag-banner-icon' });
    setIcon(iconEl, 'wifi-off');

    this.disconnectBannerEl.createSpan({ text: message, cls: 'ag-banner-text' });

    if (showReconnectBtn) {
      const reconnectBtn = this.disconnectBannerEl.createEl('button', {
        text: 'Reconnect',
        cls: 'ag-banner-btn',
      });
      reconnectBtn.addEventListener('click', () => {
        this.plugin.client.forceReconnectWs();
        this.checkGateway();
      });
    }

    const dismissBtn = this.disconnectBannerEl.createEl('button', { cls: 'ag-banner-dismiss' });
    setIcon(dismissBtn, 'x');
    dismissBtn.addEventListener('click', () => this.hideDisconnectBanner());

    this.disconnectBannerEl.show();
  }

  private hideDisconnectBanner() {
    this.disconnectBannerEl.hide();
  }

  // ── Gateway Check ──

  private async checkGateway() {
    if (this.isCheckingGateway) return;
    this.isCheckingGateway = true;
    logger.info(LOG_SRC, 'Checking gateway connectivity...');

    try {
      await this.plugin.client.getServers();
      this.gatewayConnected = true;
      logger.info(LOG_SRC, 'Gateway connected');
      this.renderHeader();
      this.hideDisconnectBanner();
      await Promise.all([this.loadConversations(), this.loadModels()]);
    } catch (err: any) {
      this.gatewayConnected = false;
      logger.error(LOG_SRC, 'Gateway unreachable', { message: err?.message });
      this.renderHeader();
      this.showGatewayError();
    } finally {
      this.isCheckingGateway = false;
    }
  }

  private showGatewayError() {
    this.conversationListEl.empty();
    const errorDiv = this.conversationListEl.createDiv({ cls: 'ag-gateway-error' });
    const iconEl = errorDiv.createDiv({ cls: 'ag-gateway-error-icon' });
    setIcon(iconEl, 'wifi-off');
    errorDiv.createDiv({ text: 'Cannot connect to Gateway', cls: 'ag-gateway-error-title' });
    errorDiv.createDiv({
      text: `Make sure Antigravity Gateway is running at:`,
      cls: 'ag-gateway-error-desc',
    });
    errorDiv.createDiv({
      text: this.plugin.settings.gatewayUrl,
      cls: 'ag-gateway-error-url',
    });

    // Troubleshooting tips
    const tipsEl = errorDiv.createDiv({ cls: 'ag-gateway-error-tips' });
    tipsEl.createDiv({ text: 'Troubleshooting:', cls: 'ag-gateway-error-tips-title' });
    const tipsList = tipsEl.createEl('ul');
    tipsList.createEl('li', { text: 'Check if the Gateway server is started' });
    tipsList.createEl('li', { text: 'Verify the URL in plugin Settings' });
    tipsList.createEl('li', { text: 'Check firewall / network settings' });

    // Retry button
    const actionsEl = errorDiv.createDiv({ cls: 'ag-gateway-error-actions' });
    const retryBtn = actionsEl.createEl('button', { text: 'Retry Connection', cls: 'ag-retry-btn' });
    retryBtn.addEventListener('click', () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Connecting...';
      retryBtn.addClass('ag-retry-loading');
      this.checkGateway().finally(() => {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry Connection';
        retryBtn.removeClass('ag-retry-loading');
      });
    });

    // Settings link
    const settingsBtn = actionsEl.createEl('button', { text: 'Open Settings', cls: 'ag-settings-btn' });
    settingsBtn.addEventListener('click', () => {
      // Open Obsidian settings for this plugin
      (this.app as any).setting?.open?.();
      (this.app as any).setting?.openTabById?.('obsidian-antigravity');
    });
  }

  private async loadModels() {
    try {
      this.models = await this.plugin.client.getModels();
      logger.debug(LOG_SRC, `Loaded ${this.models.length} models`);
    } catch (err: any) {
      logger.warn(LOG_SRC, 'Failed to load models', { message: err?.message });
    }
  }

  // ── Header ──

  private renderHeader() {
    this.headerEl.empty();

    const titleRow = this.headerEl.createDiv({ cls: 'ag-header-row' });

    // Back button (when in conversation)
    if (!this.showingConversationList) {
      const backBtn = titleRow.createEl('button', { cls: 'ag-icon-btn' });
      setIcon(backBtn, 'arrow-left');
      backBtn.addEventListener('click', () => this.showConversationList());
    }

    titleRow.createSpan({ text: this.showingConversationList ? 'Google Antigravity' : 'Chat', cls: 'ag-title' });

    // Connection status dot
    const statusDot = titleRow.createSpan({
      cls: `ag-status-dot ${this.gatewayConnected ? 'ag-dot-connected' : 'ag-dot-disconnected'}`,
      attr: { 'aria-label': this.gatewayConnected ? 'Connected' : 'Disconnected' },
    });
    statusDot.title = this.gatewayConnected
      ? `Connected to ${this.plugin.settings.gatewayUrl}`
      : 'Gateway not reachable — click to retry';
    if (!this.gatewayConnected) {
      statusDot.addClass('ag-dot-clickable');
      statusDot.addEventListener('click', () => this.checkGateway());
    }

    // New conversation button
    const newBtn = titleRow.createEl('button', { cls: 'ag-icon-btn' });
    setIcon(newBtn, 'plus');
    newBtn.addEventListener('click', () => this.createNewConversation());
  }

  // ── Workspace Resolution ──

  private async getWorkspaceUri(): Promise<string> {
    // 1. Explicit setting
    if (this.plugin.settings.workspaceUri) {
      return this.plugin.settings.workspaceUri;
    }

    // 2. Auto-detect: check if vault path matches any connected workspace
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    try {
      const servers = await this.plugin.client.getServers();
      for (const s of servers) {
        const ws = s.workspace || '';
        const wsPath = ws.replace('file://', '');
        if (vaultPath.startsWith(wsPath) || wsPath.startsWith(vaultPath)) {
          return ws;
        }
      }
    } catch {
      logger.debug(LOG_SRC, 'Could not auto-detect workspace (gateway unreachable)');
    }

    // 3. Fallback: use vault path as file URI
    return `file://${vaultPath}`;
  }

  // ── Conversation List ──

  private async loadConversations() {
    this.conversationListEl.empty();

    try {
      const workspace = await this.getWorkspaceUri();
      const conversations = await this.plugin.client.getConversations(workspace);
      logger.info(LOG_SRC, `Loaded ${conversations.length} conversations`);

      if (conversations.length === 0) {
        this.conversationListEl.createDiv({ text: 'No conversations yet. Click + to start.', cls: 'ag-empty' });
        return;
      }

      // Sort by mtime descending
      conversations.sort((a: Conversation, b: Conversation) => b.mtime - a.mtime);

      for (const conv of conversations) {
        const item = this.conversationListEl.createDiv({ cls: 'ag-conv-item' });
        const title = item.createDiv({ cls: 'ag-conv-title', text: conv.title || 'Untitled' });
        const meta = item.createDiv({ cls: 'ag-conv-meta' });
        meta.createSpan({ text: `${conv.steps} steps` });
        meta.createSpan({ text: ' · ' });
        meta.createSpan({ text: this.formatTime(conv.mtime) });

        item.addEventListener('click', () => this.openConversation(conv.id));
      }
    } catch (err: any) {
      logger.error(LOG_SRC, 'Failed to load conversations', { message: err?.message });
      this.gatewayConnected = false;
      this.renderHeader();
      this.showGatewayError();
    }
  }

  private showConversationList() {
    if (this.currentCascadeId) {
      this.plugin.client.unsubscribe(this.currentCascadeId);
    }
    this.currentCascadeId = null;
    this.steps = [];
    this.showingConversationList = true;
    this.renderHeader();
    this.conversationListEl.show();
    this.messagesEl.hide();
    this.inputContainerEl.hide();
    this.hideDisconnectBanner();
    this.loadConversations();
  }

  // ── Open Conversation ──

  private async openConversation(cascadeId: string) {
    logger.info(LOG_SRC, `Opening conversation ${cascadeId.slice(0, 8)}`);
    this.currentCascadeId = cascadeId;
    this.showingConversationList = false;
    this.renderHeader();
    this.conversationListEl.hide();
    this.messagesEl.show();
    this.inputContainerEl.show();
    this.messagesEl.empty();

    // Load existing steps
    try {
      const data = await this.plugin.client.getSteps(cascadeId);
      this.steps = data.steps || [];
      this.isStreaming = data.cascadeStatus === 'running';
      this.renderMessages();
    } catch (err: any) {
      logger.warn(LOG_SRC, 'Failed to load steps', { message: err?.message });
      this.steps = [];
      this.renderMessages();
    }

    // Subscribe to real-time updates
    this.plugin.client.connectWs();
    this.plugin.client.subscribe(cascadeId, (data: any) => {
      if (data.type === 'steps' && data.data?.steps) {
        this.steps = data.data.steps;
        this.isStreaming = data.cascadeStatus === 'running';
        this.renderMessages();
      } else if (data.type === 'status') {
        this.isStreaming = data.cascadeStatus === 'running';
        this.updateStreamingIndicator();
      }
    });
  }

  // ── Create Conversation ──

  private async createNewConversation() {
    logger.info(LOG_SRC, 'Creating new conversation...');
    try {
      const workspace = await this.getWorkspaceUri();
      const result = await this.plugin.client.createConversation(workspace);
      if (result.cascadeId) {
        logger.info(LOG_SRC, `Conversation created: ${result.cascadeId.slice(0, 8)}`);
        await this.openConversation(result.cascadeId);
      } else if (result.error) {
        logger.error(LOG_SRC, 'Create conversation returned error', { error: result.error });
        const container = this.showingConversationList ? this.conversationListEl : this.messagesEl;
        container.querySelectorAll('.ag-error').forEach(el => el.remove());
        const errEl = container.createDiv({ cls: 'ag-error' });
        errEl.createSpan({ text: `Error: ${result.error}` });
      }
    } catch (err: any) {
      logger.error(LOG_SRC, 'Create conversation failed', { message: err?.message });
      this.gatewayConnected = false;
      this.renderHeader();
      if (this.showingConversationList) {
        this.showGatewayError();
      } else {
        this.messagesEl.querySelectorAll('.ag-error').forEach(el => el.remove());
        const errEl = this.messagesEl.createDiv({ cls: 'ag-error' });
        errEl.createSpan({ text: 'Gateway unreachable. ' });
        const retryLink = errEl.createEl('a', { text: 'Retry', cls: 'ag-error-link' });
        retryLink.addEventListener('click', (e) => {
          e.preventDefault();
          this.checkGateway();
        });
      }
    }
  }

  // ── Messages Rendering ──

  private renderMessages() {
    this.messagesEl.empty();

    if (this.steps.length === 0 && !this.isStreaming) {
      this.messagesEl.createDiv({
        text: 'Start a conversation by typing a message below.',
        cls: 'ag-empty',
      });
      return;
    }

    for (const step of this.steps) {
      if (!step || !step.type) continue;
      const type = step.type.replace('CORTEX_STEP_TYPE_', '');

      switch (type) {
        case 'USER_INPUT':
          this.renderUserMessage(step);
          break;
        case 'PLANNER_RESPONSE':
          this.renderAssistantMessage(step);
          break;
        case 'CODE_ACTION':
          this.renderCodeAction(step);
          break;
        case 'RUN_COMMAND':
          this.renderToolStep(step, 'terminal', step.runCommand?.command || step.runCommand?.commandLine || '');
          break;
        case 'VIEW_FILE':
          this.renderToolStep(step, 'eye', `View ${(step.viewFile?.absoluteUri || '').split('/').pop() || 'file'}`);
          break;
        case 'GREP_SEARCH':
          this.renderToolStep(step, 'search', `Search: ${step.grepSearch?.query || step.grepSearch?.searchPattern || '...'}`);
          break;
        case 'SEARCH_WEB':
          this.renderSearchWeb(step);
          break;
        case 'LIST_DIRECTORY':
          this.renderToolStep(step, 'folder-open', `List ${(step.listDirectory?.path || '').split('/').pop() || '...'}`);
          break;
        case 'FIND':
          this.renderToolStep(step, 'file-search', `Find ${step.find?.pattern || '...'}`);
          break;
        case 'COMMAND_STATUS':
          this.renderToolStep(step, 'terminal', 'Command output');
          break;
        case 'SEND_COMMAND_INPUT':
          this.renderToolStep(step, 'keyboard', 'Send input');
          break;
        case 'BROWSER_SUBAGENT':
          this.renderToolStep(step, 'monitor', step.browserSubagent?.taskName || step.browserSubagent?.task?.slice(0, 40) || 'Browser task');
          break;
        case 'READ_URL_CONTENT':
          this.renderToolStep(step, 'link', `Read URL`);
          break;
        case 'NOTIFY_USER':
          this.renderNotifyUser(step);
          break;
        case 'ERROR_MESSAGE':
          this.renderError(step);
          break;
        case 'TASK_BOUNDARY':
          this.renderTaskBoundary(step);
          break;
      }
    }

    this.updateStreamingIndicator();

    // Scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderUserMessage(step: Step) {
    const bubble = this.messagesEl.createDiv({ cls: 'ag-msg ag-msg-user' });
    const items = step.userInput?.items || [];
    const text = items.map(i => i.text || '').filter(Boolean).join('\n');
    bubble.createDiv({ text: text || '(empty)', cls: 'ag-msg-text' });
  }

  private renderAssistantMessage(step: Step) {
    const pr = step.plannerResponse || {};
    const text = pr.modifiedResponse || pr.response || '';
    if (!text) return;

    const bubble = this.messagesEl.createDiv({ cls: 'ag-msg ag-msg-assistant' });
    const contentEl = bubble.createDiv({ cls: 'ag-msg-text' });

    // Render as markdown
    MarkdownRenderer.render(this.app, text, contentEl, '', this.plugin);

    // Copy button
    const copyBtn = bubble.createDiv({ cls: 'ag-copy-btn', attr: { 'aria-label': 'Copy' } });
    setIcon(copyBtn, 'copy');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      copyBtn.empty();
      setIcon(copyBtn, 'check');
      setTimeout(() => { copyBtn.empty(); setIcon(copyBtn, 'copy'); }, 1500);
    });
  }

  private renderCodeAction(step: Step) {
    const spec = step.codeAction?.actionSpec || {};
    const fileSpec = spec.createFile || spec.editFile || spec.deleteFile;
    if (!fileSpec) return;

    const action = spec.createFile ? 'Created' : spec.deleteFile ? 'Deleted' : 'Edited';
    const rawPath = fileSpec.absoluteUri || fileSpec.path?.absoluteUri || fileSpec.path || '';
    const uri = typeof rawPath === 'string' ? rawPath : '';
    let decoded = uri;
    try { decoded = decodeURIComponent(uri); } catch {}
    const fileName = decoded.split('/').pop() || (step.codeAction as any)?.description?.slice(0, 40) || '?';
    const icon = spec.createFile ? 'file-plus' : spec.deleteFile ? 'file-minus' : 'file-edit';
    const cls = spec.createFile ? 'ag-step-create' : spec.deleteFile ? 'ag-step-delete' : 'ag-step-edit';

    const el = this.messagesEl.createDiv({ cls: `ag-step ag-step-clickable ${cls}` });
    this.renderStepStatus(step, el);
    const iconSpan = el.createSpan({ cls: 'ag-step-icon' });
    setIcon(iconSpan, icon);
    el.createSpan({ text: `${action} ${fileName}`, cls: 'ag-step-text' });

    if (uri) {
      el.addEventListener('click', () => {
        const filePath = uri.startsWith('file://') ? uri.replace(/^file:\/\//, '') : uri;
        const vaultPath = (this.app.vault.adapter as any).basePath || '';
        const relativePath = filePath.startsWith(vaultPath)
          ? filePath.slice(vaultPath.length).replace(/^\//, '')
          : filePath.startsWith('/')
            ? filePath.split('/').pop() || fileName
            : filePath || fileName;
        this.app.workspace.openLinkText(relativePath, '', false);
      });
    }
  }

  private renderToolStep(step: Step, icon: string, text: string) {
    const el = this.messagesEl.createDiv({ cls: 'ag-step ag-step-tool' });
    this.renderStepStatus(step, el);
    const iconSpan = el.createSpan({ cls: 'ag-step-icon' });
    setIcon(iconSpan, icon);
    el.createSpan({ text: text.slice(0, 80), cls: 'ag-step-text' });
  }

  private renderSearchWeb(step: Step) {
    const sw = step.searchWeb || {};
    const query = sw.query || '...';
    const summary = sw.summary || '';

    const el = this.messagesEl.createDiv({ cls: 'ag-step ag-step-search' });
    this.renderStepStatus(step, el);
    const iconSpan = el.createSpan({ cls: 'ag-step-icon' });
    setIcon(iconSpan, 'globe');

    const contentDiv = el.createDiv({ cls: 'ag-search-content' });
    contentDiv.createDiv({ text: `🔍 ${query}`, cls: 'ag-search-query' });
    if (summary) {
      contentDiv.createDiv({ text: summary.slice(0, 200), cls: 'ag-search-summary' });
    }
  }

  private renderNotifyUser(step: Step) {
    const content = step.notifyUser?.notificationContent || '';
    if (!content) return;

    const el = this.messagesEl.createDiv({ cls: 'ag-msg ag-msg-notify' });
    const contentEl = el.createDiv({ cls: 'ag-msg-text' });
    MarkdownRenderer.render(this.app, content, contentEl, '', this.plugin);
  }

  private renderStepStatus(step: Step, container: HTMLElement): HTMLSpanElement | null {
    const status = step.status || '';
    if (status.includes('RUNNING') || status.includes('GENERATING')) {
      const s = container.createSpan({ cls: 'ag-step-status ag-status-running' });
      setIcon(s, 'loader-2');
      return s;
    }
    if (status.includes('PENDING')) {
      const s = container.createSpan({ cls: 'ag-step-status ag-status-pending' });
      setIcon(s, 'clock');
      return s;
    }
    if (status.includes('ERROR')) {
      const s = container.createSpan({ cls: 'ag-step-status ag-status-error' });
      setIcon(s, 'x-circle');
      return s;
    }
    return null;
  }

  private renderError(step: Step) {
    const msg = step.errorMessage?.message || 'Unknown error';
    const el = this.messagesEl.createDiv({ cls: 'ag-step ag-step-error' });
    el.createSpan({ text: `⚠ ${msg.slice(0, 200)}` });
  }

  private renderTaskBoundary(step: Step) {
    const tb = step.taskBoundary;
    if (!tb || !tb.taskStatus) return;

    const el = this.messagesEl.createDiv({ cls: 'ag-step ag-step-boundary' });
    el.createSpan({
      text: `${tb.mode || ''} ${tb.taskName || ''} — ${tb.taskStatus}`.trim(),
      cls: 'ag-step-text',
    });
    if (tb.taskSummary) {
      el.createDiv({ text: tb.taskSummary, cls: 'ag-step-summary' });
    }
  }

  private updateStreamingIndicator() {
    const existing = this.messagesEl.querySelector('.ag-streaming');
    if (existing) existing.remove();

    if (this.isStreaming) {
      const indicator = this.messagesEl.createDiv({ cls: 'ag-streaming' });
      indicator.createSpan({ text: 'Thinking', cls: 'ag-streaming-text' });
      const dots = indicator.createSpan({ cls: 'ag-streaming-dots' });
      dots.createSpan({ text: '.' });
      dots.createSpan({ text: '.' });
      dots.createSpan({ text: '.' });
    }

    // Update send button state
    if (this.sendBtnEl) {
      if (this.isStreaming) {
        setIcon(this.sendBtnEl, 'square');
        this.sendBtnEl.title = 'Cancel';
      } else {
        setIcon(this.sendBtnEl, 'send');
        this.sendBtnEl.title = 'Send';
      }
    }
  }

  // ── Input ──

  private renderInput() {
    // Toolbar row: mode toggle + model selector
    const toolbar = this.inputContainerEl.createDiv({ cls: 'ag-toolbar' });
    this.renderToolbar(toolbar);

    const row = this.inputContainerEl.createDiv({ cls: 'ag-input-row' });

    this.inputEl = row.createEl('textarea', {
      cls: 'ag-input',
      attr: { placeholder: 'Ask anything...', rows: '1' },
    });

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + 'px';
    });

    // Enter to send, Shift+Enter for newline
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtnEl = row.createEl('button', { cls: 'ag-send-btn' });
    setIcon(this.sendBtnEl, 'send');
    this.sendBtnEl.addEventListener('click', () => this.handleSend());
  }

  private renderToolbar(container: HTMLElement) {
    container.empty();

    // Plan / Fast toggle
    const modeBtn = container.createEl('button', { cls: 'ag-mode-btn' });
    if (this.agenticMode) {
      const iconSpan = modeBtn.createSpan({ cls: 'ag-mode-icon' });
      setIcon(iconSpan, 'rocket');
      modeBtn.createSpan({ text: ' Planning' });
      modeBtn.addClass('ag-mode-planning');
    } else {
      const iconSpan = modeBtn.createSpan({ cls: 'ag-mode-icon' });
      setIcon(iconSpan, 'zap');
      modeBtn.createSpan({ text: ' Fast' });
      modeBtn.addClass('ag-mode-fast');
    }
    modeBtn.title = this.agenticMode ? 'Plan before executing' : 'Execute directly';
    modeBtn.addEventListener('click', () => {
      this.agenticMode = !this.agenticMode;
      this.renderToolbar(container);
    });

    // Model selector
    const modelBtn = container.createEl('button', { cls: 'ag-model-btn' });
    const modelLabel = this.getModelLabel();
    const quotaPct = this.getModelQuota();
    modelBtn.createSpan({ text: modelLabel, cls: 'ag-model-label' });
    if (quotaPct !== null) {
      const quotaCls = quotaPct > 50 ? 'ag-quota-ok' : quotaPct > 20 ? 'ag-quota-warn' : 'ag-quota-low';
      modelBtn.createSpan({ text: ` ${quotaPct}%`, cls: `ag-model-quota-inline ${quotaCls}` });
    }
    const chevron = modelBtn.createSpan({ cls: 'ag-model-chevron' });
    setIcon(chevron, 'chevron-down');

    modelBtn.addEventListener('click', (e) => {
      this.showModelMenu(modelBtn);
    });
  }

  private getModelLabel(): string {
    if (this.currentModel === 'MODEL_AUTO') return 'Auto';
    const m = this.models.find(m => m.modelOrAlias?.model === this.currentModel);
    return m?.label || this.currentModel.replace(/^MODEL_PLACEHOLDER_/, '');
  }

  private getModelQuota(): number | null {
    if (this.currentModel === 'MODEL_AUTO') return null;
    const m = this.models.find(m => m.modelOrAlias?.model === this.currentModel);
    if (m?.quotaInfo?.remainingFraction != null) {
      return Math.round(m.quotaInfo.remainingFraction * 100);
    }
    return null;
  }

  private showModelMenu(anchorEl: HTMLElement) {
    const existing = document.querySelector('.ag-model-dropdown');
    if (existing) { existing.remove(); return; }

    const dropdown = document.body.createDiv({ cls: 'ag-model-dropdown' });

    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';

    // Auto option
    const autoItem = dropdown.createDiv({
      cls: `ag-model-item ${this.currentModel === 'MODEL_AUTO' ? 'ag-model-selected' : ''}`,
      text: '✨ Auto',
    });
    autoItem.addEventListener('click', () => {
      this.currentModel = 'MODEL_AUTO';
      dropdown.remove();
      this.renderToolbar(this.inputContainerEl.querySelector('.ag-toolbar')!);
    });

    for (const m of this.models) {
      const val = m.modelOrAlias?.model || '';
      if (!val) continue;
      const pct = m.quotaInfo?.remainingFraction != null
        ? ` (${Math.round(m.quotaInfo.remainingFraction * 100)}%)`
        : '';
      const item = dropdown.createDiv({
        cls: `ag-model-item ${val === this.currentModel ? 'ag-model-selected' : ''}`,
      });
      item.createSpan({ text: m.label });
      if (pct) item.createSpan({ text: pct, cls: 'ag-model-quota' });
      item.addEventListener('click', () => {
        this.currentModel = val;
        dropdown.remove();
        this.renderToolbar(this.inputContainerEl.querySelector('.ag-toolbar')!);
      });
    }

    const closeHandler = (ev: MouseEvent) => {
      if (!dropdown.contains(ev.target as Node) && !anchorEl.contains(ev.target as Node)) {
        dropdown.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private async handleSend() {
    if (!this.currentCascadeId) return;

    if (this.isStreaming) {
      logger.info(LOG_SRC, 'Cancelling generation');
      await this.plugin.client.cancelGeneration(this.currentCascadeId);
      return;
    }

    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';

    logger.info(LOG_SRC, 'Sending message', { length: text.length });

    // Optimistically show user message
    const userStep: Step = {
      type: 'CORTEX_STEP_TYPE_USER_INPUT',
      userInput: { items: [{ text }] },
    };
    this.steps.push(userStep);
    this.isStreaming = true;
    this.renderMessages();

    try {
      const model = this.currentModel !== 'MODEL_AUTO' ? this.currentModel : undefined;
      await this.plugin.client.sendMessage(this.currentCascadeId, text, this.agenticMode, model);
    } catch (err: any) {
      logger.error(LOG_SRC, 'Send message failed', { message: err?.message });
      this.isStreaming = false;

      // Check if this is a gateway disconnect
      const isDisconnect = !await this.plugin.client.ping();

      const errorStep: Step = {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        errorMessage: {
          message: isDisconnect
            ? 'Gateway disconnected. Please check connection and retry.'
            : `Send failed: ${err.message}`,
        },
      };
      this.steps.push(errorStep);
      this.renderMessages();

      if (isDisconnect) {
        this.gatewayConnected = false;
        this.renderHeader();
        this.showDisconnectBanner('Gateway connection lost during send.', true);
      }
    }
  }

  // ── Helpers ──

  private formatTime(mtime: number): string {
    const d = new Date(mtime);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

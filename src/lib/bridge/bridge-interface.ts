/**
 * IDE Bridge Interface
 *
 * Unified interface for communicating with different IDE backends.
 * Currently only Antigravity (Connect-JSON gRPC) is implemented.
 * Future: Cortex, Cursor, CLI exec adapters.
 */

export interface LanguageServerInfo {
  pid: number;
  port: number;
  csrf: string;
  workspace: string;
}

export interface StepUpdate {
  type: 'steps' | 'status' | 'error';
  steps?: any[];
  isActive?: boolean;
  cascadeStatus?: string;
  lastTaskBoundary?: number;
}

export interface IDEBridge {
  readonly kind: string;

  discoverServers(): Promise<LanguageServerInfo[]>;

  startConversation(
    port: number, csrf: string, apiKey: string, workspaceUri: string
  ): Promise<string>;

  sendMessage(
    port: number, csrf: string, apiKey: string,
    conversationId: string, text: string, model?: string
  ): Promise<void>;

  cancelConversation(
    port: number, csrf: string, apiKey: string, conversationId: string
  ): Promise<void>;

  subscribeSteps(
    port: number, csrf: string, conversationId: string,
    onUpdate: (update: StepUpdate) => void
  ): () => void;

  getApiKey(): Promise<string>;
  getModels(port: number, csrf: string, apiKey: string): Promise<any[]>;
}

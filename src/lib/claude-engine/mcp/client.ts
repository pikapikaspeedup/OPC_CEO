import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  CallToolResult,
  ReadResourceResult,
  Resource,
  ServerCapabilities,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type {
  McpCapabilities,
  McpContentItem,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerState,
  McpTool,
  McpToolResult,
} from './types';

type SdkClientLike = {
  connect: (transport: SdkTransportLike) => Promise<void>;
  close?: () => Promise<void>;
  getServerCapabilities: () => ServerCapabilities | undefined;
  listTools: (params?: { cursor?: string }) => Promise<{
    tools: Tool[];
    nextCursor?: string;
  }>;
  callTool: (params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) => Promise<CallToolResult>;
  listResources: (params?: { cursor?: string }) => Promise<{
    resources: Resource[];
    nextCursor?: string;
  }>;
  readResource: (params: { uri: string }) => Promise<ReadResourceResult>;
};

type SdkTransportLike = {
  close?: () => Promise<void>;
};

export type McpClientDependencies = {
  createSdkClient?: () => SdkClientLike;
  createSdkTransport?: (params: StdioServerParameters) => SdkTransportLike;
  createSseTransport?: (url: URL, opts?: Record<string, unknown>) => SdkTransportLike;
  createHttpTransport?: (url: URL, opts?: Record<string, unknown>) => SdkTransportLike;
};

export interface McpClientLike {
  connect(): Promise<McpCapabilities>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  listResources(): Promise<McpResource[]>;
  readResource(uri: string): Promise<McpResourceContent[]>;
  getState(): McpServerState;
  getConfig(): McpServerConfig;
  disconnect(): Promise<void>;
}

export class McpClient implements McpClientLike {
  private sdkClient: SdkClientLike | null = null;
  private sdkTransport: SdkTransportLike | null = null;
  private state: McpServerState = { status: 'disconnected' };

  constructor(
    private config: McpServerConfig,
    private dependencies: McpClientDependencies = {},
  ) {}

  async connect(): Promise<McpCapabilities> {
    if (this.state.status === 'connected') {
      return this.state.capabilities;
    }

    this.state = { status: 'connecting' };

    try {
      const sdkTransport = this.createTransport();
      const sdkClient =
        this.dependencies.createSdkClient?.() ??
        new Client(
          { name: 'claude-engine', version: '1.0.0' },
          { capabilities: {} },
        );

      await sdkClient.connect(sdkTransport as unknown as import('@modelcontextprotocol/sdk/shared/transport.js').Transport);

      this.sdkClient = sdkClient as unknown as SdkClientLike;
      this.sdkTransport = sdkTransport;

      const capabilities = normalizeCapabilities(
        sdkClient.getServerCapabilities(),
      );
      this.state = { status: 'connected', capabilities };
      return capabilities;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { status: 'error', error: message };
      throw error;
    }
  }

  private createTransport(): SdkTransportLike {
    switch (this.config.type) {
      case 'stdio':
        return this.createStdioTransport();
      case 'sse':
        return this.createSseTransport();
      case 'http':
        return this.createHttpTransport();
      default:
        throw new Error(`Unsupported MCP transport type: ${this.config.type}`);
    }
  }

  private createStdioTransport(): SdkTransportLike {
    if (!this.config.command) {
      this.failConnection('MCP stdio server command is required');
    }

    const transportParams: StdioServerParameters = {
      command: this.config.command!,
      args: this.config.args,
      env: this.config.env,
    };

    return (
      this.dependencies.createSdkTransport?.(transportParams) ??
      new StdioClientTransport(transportParams)
    );
  }

  private createSseTransport(): SdkTransportLike {
    if (!this.config.url) {
      this.failConnection('MCP SSE server URL is required');
    }

    const url = new URL(this.config.url!);
    const opts: Record<string, unknown> = {};

    if (this.config.headers && Object.keys(this.config.headers).length > 0) {
      opts.requestInit = { headers: { ...this.config.headers } };
      // SSE needs eventSourceInit for the long-lived connection
      opts.eventSourceInit = {
        fetch: async (input: string | URL, init?: RequestInit) => {
          return fetch(input, {
            ...init,
            headers: {
              ...((init?.headers as Record<string, string>) ?? {}),
              ...this.config.headers,
            },
          });
        },
      };
    }

    return (
      this.dependencies.createSseTransport?.(url, opts) ??
      new SSEClientTransport(url, opts)
    );
  }

  private createHttpTransport(): SdkTransportLike {
    if (!this.config.url) {
      this.failConnection('MCP HTTP server URL is required');
    }

    const url = new URL(this.config.url!);
    const opts: Record<string, unknown> = {};

    if (this.config.headers && Object.keys(this.config.headers).length > 0) {
      opts.requestInit = { headers: { ...this.config.headers } };
    }

    return (
      this.dependencies.createHttpTransport?.(url, opts) ??
      new StreamableHTTPClientTransport(url, opts)
    );
  }

  async listTools(): Promise<McpTool[]> {
    const client = this.requireClient();
    const tools: McpTool[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...result.tools.map(mapTool));
      cursor = result.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const client = this.requireClient();
    const result = await client.callTool({
      name,
      arguments: args,
    });

    return {
      content: (result.content ?? []).map(mapContentItem),
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }

  async listResources(): Promise<McpResource[]> {
    const client = this.requireClient();
    const resources: McpResource[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.listResources(
        cursor ? { cursor } : undefined,
      );
      resources.push(...result.resources.map(mapResource));
      cursor = result.nextCursor;
    } while (cursor);

    return resources;
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const client = this.requireClient();
    const result = await client.readResource({ uri });

    return result.contents.map(mapResourceContent);
  }

  getState(): McpServerState {
    return this.state;
  }

  getConfig(): McpServerConfig {
    return this.config;
  }

  async disconnect(): Promise<void> {
    try {
      if (this.sdkClient?.close) {
        await this.sdkClient.close();
      } else if (this.sdkTransport?.close) {
        await this.sdkTransport.close();
      }
    } finally {
      this.sdkClient = null;
      this.sdkTransport = null;
      this.state = { status: 'disconnected' };
    }
  }

  private requireClient(): SdkClientLike {
    if (!this.sdkClient || this.state.status !== 'connected') {
      throw new Error('MCP client is not connected');
    }

    return this.sdkClient;
  }

  private failConnection(message: string): never {
    this.state = { status: 'error', error: message };
    throw new Error(message);
  }
}

function normalizeCapabilities(
  capabilities: ServerCapabilities | undefined,
): McpCapabilities {
  return {
    tools: Boolean(capabilities?.tools),
    resources: Boolean(capabilities?.resources),
    prompts: Boolean(capabilities?.prompts),
  };
}

function mapTool(tool: Tool): McpTool {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}

function mapResource(resource: Resource): McpResource {
  return {
    uri: resource.uri,
    name: resource.name,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  };
}

function mapContentItem(item: CallToolResult['content'][number]): McpContentItem {
  if (item.type === 'text') {
    return { type: 'text', text: item.text };
  }

  if (item.type === 'image') {
    return {
      type: 'image',
      data: item.data,
      mimeType: item.mimeType,
    };
  }

  if (item.type === 'resource') {
    return {
      type: 'resource',
      resource: mapEmbeddedResource(item.resource),
    };
  }

  if (item.type === 'resource_link') {
    return {
      type: 'resource',
      resource: {
        uri: item.uri,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
      },
    };
  }

  return {
    type: 'text',
    text: JSON.stringify(item),
  };
}

function mapEmbeddedResource(resource: {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}): McpResourceContent {
  return {
    uri: resource.uri,
    ...(resource.text !== undefined ? { text: resource.text } : {}),
    ...(resource.blob !== undefined ? { blob: resource.blob } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  };
}

function mapResourceContent(
  content: ReadResourceResult['contents'][number],
): McpResourceContent {
  return {
    uri: content.uri,
    ...('text' in content ? { text: content.text } : {}),
    ...('blob' in content ? { blob: content.blob } : {}),
    ...(content.mimeType ? { mimeType: content.mimeType } : {}),
  };
}
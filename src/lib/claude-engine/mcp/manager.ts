import { z } from 'zod';

import type { Tool } from '../types';
import { McpClient, type McpClientLike } from './client';
import type {
  McpServerConfig,
  McpServerState,
  McpTool,
  McpToolResult,
} from './types';

export type McpManagerDependencies = {
  createClient?: (config: McpServerConfig) => McpClientLike;
};

export class McpManager {
  private clients: Map<string, McpClientLike> = new Map();

  constructor(private dependencies: McpManagerDependencies = {}) {}

  async addServer(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      await this.removeServer(config.name);
    }

    const client =
      this.dependencies.createClient?.(config) ?? new McpClient(config);

    await client.connect();
    this.clients.set(config.name, client);
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      return;
    }

    await client.disconnect();
    this.clients.delete(name);
  }

  async getAllTools(): Promise<
    Array<Tool<Record<string, unknown>, McpToolResult>>
  > {
    const tools: Array<Tool<Record<string, unknown>, McpToolResult>> = [];

    for (const [serverName, client] of this.clients) {
      const serverTools = await client.listTools();
      tools.push(
        ...serverTools.map((tool) =>
          this.createClaudeEngineTool(serverName, client, tool),
        ),
      );
    }

    return tools;
  }

  async getToolsForServer(serverName: string): Promise<McpTool[]> {
    return await this.requireClient(serverName).listTools();
  }

  async callTool(
    fullToolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const parsed = McpManager.parseMcpToolName(fullToolName);
    if (!parsed) {
      throw new Error(`Invalid MCP tool name: ${fullToolName}`);
    }

    return await this.requireClient(parsed.serverName).callTool(
      parsed.toolName,
      args,
    );
  }

  getServers(): { name: string; state: McpServerState }[] {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      state: client.getState(),
    }));
  }

  async loadFromConfig(
    config: Record<string, Omit<McpServerConfig, 'name'>>,
  ): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config)) {
      await this.addServer({
        name,
        ...serverConfig,
      });
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.disconnect();
      this.clients.delete(name);
    }
  }

  static parseMcpToolName(
    fullName: string,
  ): { serverName: string; toolName: string } | null {
    if (!fullName.startsWith('mcp__')) {
      return null;
    }

    const body = fullName.slice('mcp__'.length);
    const parts = body.split('__');
    const serverName = parts.shift();
    const toolName = parts.join('__');

    if (!serverName || !toolName) {
      return null;
    }

    return { serverName, toolName };
  }

  static buildMcpToolName(serverName: string, toolName: string): string {
    return `mcp__${serverName}__${toolName}`;
  }

  private requireClient(serverName: string): McpClientLike {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    return client;
  }

  private createClaudeEngineTool(
    serverName: string,
    client: McpClientLike,
    tool: McpTool,
  ): Tool<Record<string, unknown>, McpToolResult> {
    const fullToolName = McpManager.buildMcpToolName(serverName, tool.name);

    return {
      name: fullToolName,
      inputSchema: z.object({}).passthrough(),
      inputJSONSchema: tool.inputSchema,
      description: () =>
        tool.description ?? `Call MCP tool ${tool.name} on ${serverName}`,
      call: async (args) => ({
        data: await client.callTool(tool.name, args),
      }),
      isEnabled: () => client.getState().status === 'connected',
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      maxResultSizeChars: 50_000,
    };
  }
}
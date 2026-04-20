/**
 * MCP 资源工具 — 列出和读取 MCP 服务器资源
 * 基于已有的 claude-engine/mcp 子系统
 * 简化自 claude-code ListMcpResourcesTool + ReadMcpResourceTool
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";
import type { McpResource, McpContentItem } from "../mcp/types";

// ── MCP Provider 接口（由外部注入）──────────────────────────────────

export type McpResourceProvider = {
	listResources(serverName?: string): Promise<Array<McpResource & { server: string }>>;
	readResource(serverName: string, uri: string): Promise<McpContentItem[]>;
	getServerNames(): string[];
};

let mcpProvider: McpResourceProvider | null = null;
const scopedMcpProviders = new WeakMap<ToolContext, McpResourceProvider>();

export function setMcpResourceProvider(provider: McpResourceProvider): void {
	mcpProvider = provider;
}

export function clearMcpResourceProvider(): void {
	mcpProvider = null;
}

export function bindMcpResourceProvider(
	context: ToolContext,
	provider: McpResourceProvider,
): void {
	scopedMcpProviders.set(context, provider);
}

export function unbindMcpResourceProvider(context: ToolContext): void {
	scopedMcpProviders.delete(context);
}

function getMcpProvider(context: ToolContext): McpResourceProvider | null {
	return scopedMcpProviders.get(context) ?? mcpProvider;
}

// ── ListMcpResourcesTool ───────────────────────────────────────────

const listSchema = z.object({
	server: z
		.string()
		.optional()
		.describe("Filter resources by MCP server name"),
});

export const listMcpResourcesTool = {
	name: "ListMcpResourcesTool",
	aliases: ["list_mcp_resources", "mcp_resources"],
	inputSchema: listSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			server: {
				type: "string",
				description: "Filter resources by MCP server name",
			},
		},
	},
	description: () => "List resources available from MCP servers",

		async call(
			args: z.infer<typeof listSchema>,
			context: ToolContext,
		): Promise<ToolResult<string>> {
			const provider = getMcpProvider(context);
			if (!provider) {
				return { data: "No MCP resource provider configured. Use setMcpResourceProvider() to enable." };
			}

			const resources = await provider.listResources(args.server);

		if (resources.length === 0) {
			return {
				data: args.server
					? `No resources found on server "${args.server}".`
					: "No resources found on any MCP server.",
			};
		}

		const lines = [`MCP Resources (${resources.length}):`, ""];
		const byServer = new Map<string, typeof resources>();
		for (const r of resources) {
			const list = byServer.get(r.server) ?? [];
			list.push(r);
			byServer.set(r.server, list);
		}

		for (const [server, serverResources] of byServer) {
			lines.push(`### ${server}`);
			for (const r of serverResources) {
				lines.push(`- **${r.name}** (${r.uri})`);
				if (r.description) lines.push(`  ${r.description}`);
				if (r.mimeType) lines.push(`  Type: ${r.mimeType}`);
			}
			lines.push("");
		}

		return { data: lines.join("\n") };
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 30_000,
	isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
	isDestructive: () => false,
} satisfies Tool<z.infer<typeof listSchema>, string>;

// ── ReadMcpResourceTool ────────────────────────────────────────────

const readSchema = z.object({
	server: z.string().describe("Name of the MCP server"),
	uri: z.string().describe("URI of the resource to read"),
});

export const readMcpResourceTool = {
	name: "ReadMcpResourceTool",
	aliases: ["read_mcp_resource", "mcp_read"],
	inputSchema: readSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			server: { type: "string", description: "MCP server name" },
			uri: { type: "string", description: "Resource URI" },
		},
		required: ["server", "uri"],
	},
	description: (input: z.infer<typeof readSchema>) =>
		`Read resource ${input.uri} from MCP server ${input.server}`,

		async call(
			args: z.infer<typeof readSchema>,
			context: ToolContext,
		): Promise<ToolResult<string>> {
			const provider = getMcpProvider(context);
			if (!provider) {
				return { data: "No MCP resource provider configured." };
			}

			const servers = provider.getServerNames();
			if (!servers.includes(args.server)) {
				return {
					data: `MCP server "${args.server}" not found. Available: ${servers.join(", ") || "none"}`,
				};
			}

			const contents = await provider.readResource(args.server, args.uri);

		if (contents.length === 0) {
			return { data: `Resource ${args.uri} returned no content.` };
		}

		const parts: string[] = [
			`Resource: ${args.uri}`,
			`Server: ${args.server}`,
			"",
		];

		for (const item of contents) {
			switch (item.type) {
				case "text":
					parts.push(item.text);
					break;
				case "image":
					parts.push(`[Image: ${item.mimeType}, ${Math.round(item.data.length * 0.75)} bytes]`);
					break;
				case "resource":
					if (item.resource.text) {
						parts.push(item.resource.text);
					} else if (item.resource.blob) {
						parts.push(`[Binary blob: ${item.resource.uri}]`);
					}
					break;
			}
		}

		return { data: parts.join("\n") };
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 50_000,
	isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
	isDestructive: () => false,
} satisfies Tool<z.infer<typeof readSchema>, string>;

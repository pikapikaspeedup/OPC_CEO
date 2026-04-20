/**
 * ToolSearchTool — 工具搜索与发现
 * 简化自 claude-code ToolSearchTool（去除 analytics、memoization cache、AppState）
 * 根据查询文本在已注册工具集中搜索匹配的工具
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	query: z
		.string()
		.min(2)
		.describe("Natural language description of what tool capability to find"),
	maxResults: z
		.number()
		.optional()
		.describe("Maximum number of results to return (default: 10)"),
});

type Input = z.infer<typeof inputSchema>;

export type ToolInfo = {
	name: string;
	aliases?: string[];
	description: string;
	isReadOnly: boolean;
	isEnabled: boolean;
	matchScore: number;
};

/**
 * Simple keyword match scoring.
 * Returns 0-1 score based on how many query words appear in tool name/description.
 */
function scoreMatch(query: string, tool: { name: string; description: string; aliases?: string[] }): number {
	const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
	if (queryWords.length === 0) return 0;

	const haystack = [
		tool.name.toLowerCase(),
		tool.description.toLowerCase(),
		...(tool.aliases?.map((a) => a.toLowerCase()) ?? []),
	].join(" ");

	let matches = 0;
	for (const word of queryWords) {
		if (haystack.includes(word)) matches++;
	}

	return matches / queryWords.length;
}

// ── Tool registry reference (set by registry) ─────────────────────
type ToolLike = {
	name: string;
	aliases?: string[];
	description: (input: unknown) => string;
	isReadOnly: (input?: unknown) => boolean;
	isEnabled: () => boolean;
};

let registeredTools: ToolLike[] = [];

export function setToolSearchRegistry(tools: ToolLike[]): void {
	registeredTools = tools;
}

export const toolSearchTool = {
	name: "ToolSearchTool",
	aliases: ["tool_search", "search_tools", "find_tool"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Natural language description of what tool capability to find",
			},
			maxResults: {
				type: "number",
				description: "Maximum number of results (default: 10)",
			},
		},
		required: ["query"],
	},
	description: (input: Input) =>
		`Search for tools matching: ${input.query}`,

	async call(args: Input): Promise<ToolResult<string>> {
		const max = args.maxResults ?? 10;
		const tools = registeredTools;

		if (tools.length === 0) {
			return { data: "No tools registered. Use setToolSearchRegistry() to configure." };
		}

		const scored: ToolInfo[] = tools.map((t) => {
			// Get a sample description
			let desc: string;
			try {
				desc = t.description({});
			} catch {
				desc = t.name;
			}

			return {
				name: t.name,
				aliases: t.aliases,
				description: desc,
				isReadOnly: t.isReadOnly(),
				isEnabled: t.isEnabled(),
				matchScore: scoreMatch(args.query, { name: t.name, description: desc, aliases: t.aliases }),
			};
		});

		// Sort by score descending, filter out zero-score
		const results = scored
			.filter((t) => t.matchScore > 0)
			.sort((a, b) => b.matchScore - a.matchScore)
			.slice(0, max);

		if (results.length === 0) {
			// Return all tools as fallback
			const all = scored
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, max);

			const lines = [
				`No tools matched "${args.query}". Showing all ${all.length} available tools:`,
				"",
			];
			for (const t of all) {
				const flags = [
					t.isEnabled ? "" : "[disabled]",
					t.isReadOnly ? "[readonly]" : "",
				].filter(Boolean).join(" ");
				lines.push(`- **${t.name}**: ${t.description} ${flags}`);
			}
			return { data: lines.join("\n") };
		}

		const lines = [
			`Found ${results.length} tools matching "${args.query}":`,
			"",
		];
		for (const t of results) {
			const flags = [
				t.isEnabled ? "" : "[disabled]",
				t.isReadOnly ? "[readonly]" : "",
			].filter(Boolean).join(" ");
			const score = Math.round(t.matchScore * 100);
			lines.push(`- **${t.name}** (${score}% match): ${t.description} ${flags}`);
			if (t.aliases?.length) {
				lines.push(`  Aliases: ${t.aliases.join(", ")}`);
			}
		}

		return { data: lines.join("\n") };
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 20_000,
	isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

/**
 * WebSearchTool — 插件化 Web 搜索
 * 支持 Tavily / Brave Search / Kagi 后端，通过环境变量选择
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	query: z.string().min(2).describe("The search query to use"),
	allowed_domains: z
		.array(z.string())
		.optional()
		.describe("Only include results from these domains"),
	blocked_domains: z
		.array(z.string())
		.optional()
		.describe("Never include results from these domains"),
	maxResults: z
		.number()
		.optional()
		.describe("Maximum number of results to return (default: 5)"),
});

type Input = z.infer<typeof inputSchema>;

export type SearchResult = {
	title: string;
	url: string;
	snippet: string;
};

export type SearchOutput = {
	query: string;
	results: SearchResult[];
	elapsedMs: number;
	provider: string;
};

// ── Search backend adapters ────────────────────────────────────────

async function searchTavily(
	query: string,
	maxResults: number,
	signal: AbortSignal,
): Promise<{ results: SearchResult[]; provider: string }> {
	const apiKey = process.env.TAVILY_API_KEY;
	if (!apiKey) throw new Error("TAVILY_API_KEY is required for web search");

	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			api_key: apiKey,
			query,
			max_results: maxResults,
			search_depth: "basic",
		}),
		signal,
	});

	if (!resp.ok) {
		throw new Error(`Tavily search failed: ${resp.status} ${resp.statusText}`);
	}

	const data = (await resp.json()) as {
		results: Array<{ title: string; url: string; content: string }>;
	};
	return {
		results: data.results.map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.content,
		})),
		provider: "tavily",
	};
}

async function searchBrave(
	query: string,
	maxResults: number,
	signal: AbortSignal,
): Promise<{ results: SearchResult[]; provider: string }> {
	const apiKey = process.env.BRAVE_SEARCH_API_KEY;
	if (!apiKey)
		throw new Error("BRAVE_SEARCH_API_KEY is required for Brave Search");

	const params = new URLSearchParams({
		q: query,
		count: String(maxResults),
	});

	const resp = await fetch(
		`https://api.search.brave.com/res/v1/web/search?${params}`,
		{
			headers: {
				Accept: "application/json",
				"Accept-Encoding": "gzip",
				"X-Subscription-Token": apiKey,
			},
			signal,
		},
	);

	if (!resp.ok) {
		throw new Error(
			`Brave search failed: ${resp.status} ${resp.statusText}`,
		);
	}

	const data = (await resp.json()) as {
		web?: { results: Array<{ title: string; url: string; description: string }> };
	};
	return {
		results: (data.web?.results ?? []).map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.description,
		})),
		provider: "brave",
	};
}

async function searchKagi(
	query: string,
	maxResults: number,
	signal: AbortSignal,
): Promise<{ results: SearchResult[]; provider: string }> {
	const apiKey = process.env.KAGI_API_KEY;
	if (!apiKey) throw new Error("KAGI_API_KEY is required for Kagi Search");

	const params = new URLSearchParams({
		q: query,
		limit: String(maxResults),
	});

	const resp = await fetch(
		`https://kagi.com/api/v0/search?${params}`,
		{
			headers: {
				Authorization: `Bot ${apiKey}`,
			},
			signal,
		},
	);

	if (!resp.ok) {
		throw new Error(`Kagi search failed: ${resp.status} ${resp.statusText}`);
	}

	const data = (await resp.json()) as {
		data: Array<{ t: number; title?: string; url?: string; snippet?: string }>;
	};
	return {
		results: data.data
			.filter((r) => r.t === 0 && r.url) // t=0 is organic results
			.map((r) => ({
				title: r.title ?? "",
				url: r.url!,
				snippet: r.snippet ?? "",
			})),
		provider: "kagi",
	};
}

function getSearchAdapter(): typeof searchTavily {
	const provider = (
		process.env.SEARCH_PROVIDER ?? "tavily"
	).toLowerCase();
	switch (provider) {
		case "brave":
			return searchBrave;
		case "kagi":
			return searchKagi;
		case "tavily":
		default:
			return searchTavily;
	}
}

// ── Tool export ────────────────────────────────────────────────────

export const webSearchTool = {
	name: "WebSearchTool",
	aliases: ["web_search", "search"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "The search query to use" },
			allowed_domains: {
				type: "array",
				items: { type: "string" },
				description: "Only include results from these domains",
			},
			blocked_domains: {
				type: "array",
				items: { type: "string" },
				description: "Never include results from these domains",
			},
			maxResults: {
				type: "number",
				description: "Maximum number of results to return (default: 5)",
			},
		},
		required: ["query"],
	},
	description: (input: Input) => `Search the web for: ${input.query}`,

	async call(
		args: Input,
		context: ToolContext,
	): Promise<ToolResult<string>> {
		const maxResults = args.maxResults ?? 5;
		const start = Date.now();

		const adapter = getSearchAdapter();
		const { results, provider } = await adapter(
			args.query,
			maxResults,
			context.abortSignal,
		);

		// Apply domain filters
		let filtered = results;
		if (args.allowed_domains?.length) {
			const allowed = new Set(
				args.allowed_domains.map((d) => d.toLowerCase()),
			);
			filtered = filtered.filter((r) => {
				try {
					const host = new URL(r.url).hostname.toLowerCase();
					return Array.from(allowed).some(
						(d) => host === d || host.endsWith(`.${d}`),
					);
				} catch {
					return false;
				}
			});
		}
		if (args.blocked_domains?.length) {
			const blocked = new Set(
				args.blocked_domains.map((d) => d.toLowerCase()),
			);
			filtered = filtered.filter((r) => {
				try {
					const host = new URL(r.url).hostname.toLowerCase();
					return !Array.from(blocked).some(
						(d) => host === d || host.endsWith(`.${d}`),
					);
				} catch {
					return true;
				}
			});
		}

		const elapsedMs = Date.now() - start;

		const output: SearchOutput = {
			query: args.query,
			results: filtered,
			elapsedMs,
			provider,
		};

		// Format as readable text
		const lines = [
			`Search: "${args.query}" (${provider}, ${elapsedMs}ms, ${filtered.length} results)`,
			"",
		];

		for (let i = 0; i < filtered.length; i++) {
			const r = filtered[i];
			lines.push(`${i + 1}. ${r.title}`);
			lines.push(`   ${r.url}`);
			lines.push(`   ${r.snippet}`);
			lines.push("");
		}

		if (filtered.length === 0) {
			lines.push("No results found.");
		}

		return { data: lines.join("\n") };
	},

	isEnabled: () => {
		// Enabled if any search API key is set
		return !!(
			process.env.TAVILY_API_KEY ||
			process.env.BRAVE_SEARCH_API_KEY ||
			process.env.KAGI_API_KEY
		);
	},
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 30_000,
	isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

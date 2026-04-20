/**
 * WebFetchTool — 获取 URL 内容并转换为 Markdown
 * 移植自 claude-code/src/tools/WebFetchTool，去除 queryHaiku 和 Ink UI 依赖
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	url: z.string().url().describe("The URL to fetch content from"),
	prompt: z
		.string()
		.optional()
		.describe("Optional prompt describing what to extract from the content"),
	maxLength: z
		.number()
		.optional()
		.describe("Maximum character length of returned content"),
});

type Input = z.infer<typeof inputSchema>;

type FetchOutput = {
	url: string;
	status: number;
	contentType: string;
	content: string;
	byteLength: number;
	truncated: boolean;
	elapsedMs: number;
};

// ── Simple LRU cache ───────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_ENTRIES = 50;

type CacheEntry = {
	response: FetchOutput;
	timestamp: number;
};

const cache = new Map<string, CacheEntry>();

function getCached(url: string): FetchOutput | null {
	const entry = cache.get(url);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		cache.delete(url);
		return null;
	}
	return entry.response;
}

function setCache(url: string, response: FetchOutput): void {
	// Evict oldest entries if over limit
	if (cache.size >= MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(url, { response, timestamp: Date.now() });
}

// ── HTML → plain text (lightweight, no external dep) ───────────────
function htmlToText(html: string): string {
	return html
		// Remove script/style blocks
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
		// Convert block elements to newlines
		.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)\b[^>]*>/gi, "\n")
		// Convert links: <a href="url">text</a> → [text](url)
		.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
		// Strip remaining tags
		.replace(/<[^>]+>/g, "")
		// Decode common entities
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		// Collapse whitespace
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ── Fetch implementation ───────────────────────────────────────────
async function fetchUrl(
	url: string,
	signal: AbortSignal,
	maxLength: number,
): Promise<FetchOutput> {
	const start = Date.now();

	const response = await fetch(url, {
		signal,
		headers: {
			"User-Agent":
				"Mozilla/5.0 (compatible; ClaudeEngine/1.0; +https://github.com/anthropics)",
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		},
		redirect: "follow",
	});

	const contentType = response.headers.get("content-type") ?? "text/plain";
	const isHtml = contentType.includes("text/html");
	const isJson = contentType.includes("application/json");

	let rawText: string;
	if (contentType.includes("application/pdf") || contentType.includes("image/")) {
		// Binary content — just report metadata
		rawText = `[Binary content: ${contentType}, ${response.headers.get("content-length") ?? "unknown"} bytes]`;
	} else {
		rawText = await response.text();
	}

	let content = isHtml ? htmlToText(rawText) : rawText;

	// Pretty-print JSON
	if (isJson) {
		try {
			content = JSON.stringify(JSON.parse(content), null, 2);
		} catch {
			// leave as-is
		}
	}

	const truncated = content.length > maxLength;
	if (truncated) {
		content = `${content.slice(0, maxLength)}\n\n[... truncated at ${maxLength} characters]`;
	}

	return {
		url: response.url, // may differ from input due to redirects
		status: response.status,
		contentType,
		content,
		byteLength: new TextEncoder().encode(rawText).length,
		truncated,
		elapsedMs: Date.now() - start,
	};
}

// ── Tool export ────────────────────────────────────────────────────
export const webFetchTool = {
	name: "WebFetchTool",
	aliases: ["web_fetch", "fetch_url"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			url: { type: "string", description: "The URL to fetch content from" },
			prompt: {
				type: "string",
				description: "Optional prompt describing what to extract from the content",
			},
			maxLength: {
				type: "number",
				description: "Maximum character length of returned content",
			},
		},
		required: ["url"],
	},
	description: (input: Input) => `Fetch content from ${input.url}`,

	async call(
		args: Input,
		context: ToolContext,
	): Promise<ToolResult<string>> {
		const maxLen = args.maxLength ?? 30_000;

		// Check cache
		const cached = getCached(args.url);
		if (cached) {
			const prompt = args.prompt
				? `\n\nRequested focus: ${args.prompt}`
				: "";
			return {
				data: `[Cached] URL: ${cached.url}\nStatus: ${cached.status}\nType: ${cached.contentType}\nSize: ${cached.byteLength} bytes\n\n${cached.content}${prompt}`,
			};
		}

		const result = await fetchUrl(args.url, context.abortSignal, maxLen);
		setCache(args.url, result);

		const prompt = args.prompt ? `\n\nRequested focus: ${args.prompt}` : "";
		const summary = [
			`URL: ${result.url}`,
			`Status: ${result.status}`,
			`Type: ${result.contentType}`,
			`Size: ${result.byteLength} bytes`,
			`Fetched in: ${result.elapsedMs}ms`,
			result.truncated ? `[Truncated to ${maxLen} chars]` : "",
		]
			.filter(Boolean)
			.join("\n");

		return {
			data: `${summary}\n\n${result.content}${prompt}`,
		};
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 50_000,
	isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

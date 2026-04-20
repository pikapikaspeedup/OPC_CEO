import * as fs from "node:fs/promises";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";
import { resolveSandboxedReadPath } from "./path-sandbox";

const inputSchema = z.object({
	file_path: z.string().describe("Absolute path to file"),
	offset: z.number().optional().describe("1-indexed line number to start from"),
	limit: z.number().optional().describe("Number of lines to read"),
});

type Input = z.infer<typeof inputSchema>;

type FileReadMetadata = {
	filePath: string;
	numLines: number;
	startLine: number;
	totalLines: number;
};

type FileReadResult = ToolResult<string> & {
	metadata: FileReadMetadata;
};

export const fileReadTool = {
	name: "FileReadTool",
	inputSchema,
	description: (input: Input) => `Read file ${input.file_path}`,
	async call(args: Input, context: ToolContext): Promise<FileReadResult> {
		const filePath = resolveSandboxedReadPath(args.file_path, context);
		const stats = await getFileStats(filePath);

		if (!stats?.isFile()) {
			throw new Error(`File not found: ${filePath}`);
		}

		const content = await fs.readFile(filePath, "utf8");
		const allLines = splitLines(content);
		const startLine = Math.max(1, Math.trunc(args.offset ?? 1));
		const limit =
			args.limit === undefined
				? undefined
				: Math.max(0, Math.trunc(args.limit));
		const selectedLines = allLines.slice(
			startLine - 1,
			limit === undefined ? undefined : startLine - 1 + limit,
		);
		const numberedLines = selectedLines
			.map((line, index) => `${startLine + index}: ${line}`)
			.join("\n");

		return {
			data: numberedLines,
			metadata: {
				filePath,
				numLines: selectedLines.length,
				startLine,
				totalLines: allLines.length,
			},
		};
	},
	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 50_000,
	getPath: (input: Input) => input.file_path,
	isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

async function getFileStats(
	filePath: string,
): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
	try {
		return await fs.stat(filePath);
	} catch {
		return null;
	}
}

function splitLines(content: string): string[] {
	if (content === "") {
		return [];
	}

	return content.split(/\r?\n/);
}

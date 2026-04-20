import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";
import { resolveSandboxedReadPath } from "./path-sandbox";

const inputSchema = z.object({
	pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts"'),
	path: z.string().optional().describe("Base directory to search from"),
});

type Input = z.infer<typeof inputSchema>;

type GlobMetadata = {
	numFiles: number;
	truncated: boolean;
	filenames: string[];
};

type GlobResult = ToolResult<string> & {
	metadata: GlobMetadata;
};

const MAX_GLOB_RESULTS = 200;

export const globTool = {
	name: "GlobTool",
	inputSchema,
	description: (input: Input) => `Search files matching ${input.pattern}`,
	async call(args: Input, context: ToolContext): Promise<GlobResult> {
		const baseDir = resolveBasePath(args.path, context);
		const stats = await fs.stat(baseDir).catch(() => null);

		if (!stats?.isDirectory()) {
			throw new Error(`Search path not found: ${baseDir}`);
		}

		const matcher = globToRegExp(args.pattern);
		const files = await listFiles(baseDir);
		const matches = files
			.map((filePath) => toPosixPath(path.relative(baseDir, filePath)))
			.filter((relativePath) => matcher.test(relativePath))
			.sort((left, right) => left.localeCompare(right));
		const truncated = matches.length > MAX_GLOB_RESULTS;
		const filenames = matches.slice(0, MAX_GLOB_RESULTS);

		return {
			data: filenames.join("\n"),
			metadata: {
				numFiles: filenames.length,
				truncated,
				filenames,
			},
		};
	},
	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 30_000,
	getPath: (input: Input) => input.path ?? "",
	isSearchOrReadCommand: () => ({
		isSearch: true,
		isRead: false,
		isList: true,
	}),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

async function listFiles(dirPath: string): Promise<string[]> {
	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			files.push(...(await listFiles(fullPath)));
			continue;
		}

		if (entry.isFile()) {
			files.push(fullPath);
		}
	}

	return files;
}

function escapeRegExpChar(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
	const normalizedPattern = toPosixPath(pattern);
	let expression = "^";

	for (let index = 0; index < normalizedPattern.length; index += 1) {
		const currentChar = normalizedPattern[index];
		const nextChar = normalizedPattern[index + 1];
		const charAfterNext = normalizedPattern[index + 2];

		if (currentChar === "*" && nextChar === "*") {
			if (charAfterNext === "/") {
				expression += "(?:.*/)?";
				index += 2;
			} else {
				expression += ".*";
				index += 1;
			}
			continue;
		}

		if (currentChar === "*") {
			expression += "[^/]*";
			continue;
		}

		if (currentChar === "?") {
			expression += "[^/]";
			continue;
		}

		expression += escapeRegExpChar(currentChar);
	}

	expression += "$";
	return new RegExp(expression);
}

function resolveBasePath(
	inputPath: string | undefined,
	context: ToolContext,
): string {
	if (!inputPath) {
		return path.resolve(context.workspacePath);
	}

	return resolveSandboxedReadPath(inputPath, context);
}

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

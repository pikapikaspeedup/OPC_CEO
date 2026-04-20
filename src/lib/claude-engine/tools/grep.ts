import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult, ValidationResult } from "../types";
import { resolveSandboxedReadPath } from "./path-sandbox";

const inputSchema = z.object({
	pattern: z.string().describe("Regex pattern to search for"),
	path: z.string().optional().describe("Directory to search in"),
	include: z.string().optional().describe('File glob filter, e.g. "*.ts"'),
	case_sensitive: z.boolean().optional().default(true),
	context_lines: z
		.number()
		.optional()
		.default(2)
		.describe("Lines of context around match"),
	max_results: z.number().optional().default(100),
});

type Input = z.infer<typeof inputSchema>;

type GrepMetadata = {
	numMatches: number;
	numFiles: number;
	truncated: boolean;
};

type GrepResult = ToolResult<string> & {
	metadata: GrepMetadata;
};

const MAX_RESULT_SIZE_CHARS = 30_000;
const TRUNCATION_MARKER = "\n...[truncated]";
const MAX_PATTERN_LENGTH = 1000;
const DANGEROUS_REGEX_PATTERNS = /\(\?[^)]*\)|\{\d{3,}\}|\(\.[*+]\)\{|\(\.[*+]\)\+/;

export const grepTool = {
	name: "GrepTool",
	inputSchema,
	description: (input: Input) => `Search for ${input.pattern}`,
	validateInput: async (input: Input): Promise<ValidationResult> => {
		if (input.pattern.length > MAX_PATTERN_LENGTH) {
			return {
				valid: false,
				message: `Pattern too long (${input.pattern.length} chars, max ${MAX_PATTERN_LENGTH})`,
			};
		}

		if (DANGEROUS_REGEX_PATTERNS.test(input.pattern)) {
			return {
				valid: false,
				message:
					"Pattern contains potentially dangerous regex constructs",
			};
		}

		try {
			new RegExp(input.pattern);
		} catch {
			return { valid: false, message: "Invalid regex pattern" };
		}

		return { valid: true };
	},
	async call(args: Input, context: ToolContext): Promise<GrepResult> {
		const searchPath = resolveSearchPath(args.path, context);
		const stats = await fs.stat(searchPath).catch(() => null);

		if (!stats?.isDirectory()) {
			throw new Error(`Search path not found: ${searchPath}`);
		}

		const command = buildSearchCommand(args, searchPath);
		const result = await context.exec(command, {
			cwd: context.workspacePath,
			timeout: 60_000,
		});

		if (result.exitCode > 1) {
			throw new Error(
				result.stderr || `Search failed with exit code ${result.exitCode}`,
			);
		}

		const rawOutput = result.stdout.trimEnd();

		if (!rawOutput) {
			return {
				data: "",
				metadata: {
					numMatches: 0,
					numFiles: 0,
					truncated: false,
				},
			};
		}

		const limitedOutput = limitMatches(rawOutput, args.max_results ?? 100);
		const truncatedOutput = truncateText(
			limitedOutput.output,
			MAX_RESULT_SIZE_CHARS,
		);

		return {
			data: truncatedOutput.text,
			metadata: {
				numMatches: limitedOutput.numMatches,
				numFiles: limitedOutput.numFiles,
				truncated: limitedOutput.truncated || truncatedOutput.truncated,
			},
		};
	},
	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 30_000,
	getPath: (input: Input) => input.path ?? "",
	isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

function buildSearchCommand(input: Input, searchPath: string): string {
	const contextLines = Math.max(0, Math.trunc(input.context_lines ?? 2));
	const caseFlag = input.case_sensitive === false ? "-i " : "";
	const baseCommand = `grep -rn -E ${caseFlag}-C ${contextLines} -- ${shellQuote(input.pattern)}`;

	if (input.include) {
		return [
			"find",
			shellQuote(searchPath),
			"-type",
			"f",
			"-name",
			shellQuote(input.include),
			"-exec",
			baseCommand,
			"{}",
			"+",
		].join(" ");
	}

	return `${baseCommand} ${shellQuote(searchPath)}`;
}

function getMatchFile(line: string): string | null {
	const match = /^(.+?):\d+:/.exec(line);
	return match ? match[1] : null;
}

function isMatchLine(line: string): boolean {
	return /^.+?:\d+:/.test(line);
}

function limitMatches(
	output: string,
	maxResults: number,
): {
	output: string;
	numMatches: number;
	numFiles: number;
	truncated: boolean;
} {
	const blocks = output.split(/\n--\n/);
	const keptBlocks: string[] = [];
	const files = new Set<string>();
	let numMatches = 0;
	let truncated = false;

	for (const block of blocks) {
		const lines = block.split("\n");
		const blockMatchCount = lines.filter(isMatchLine).length;

		if (numMatches + blockMatchCount <= maxResults) {
			keptBlocks.push(block);
			numMatches += blockMatchCount;

			for (const line of lines) {
				const fileName = getMatchFile(line);

				if (fileName) {
					files.add(fileName);
				}
			}

			continue;
		}

		const partialLines: string[] = [];
		let remainingMatches = maxResults - numMatches;

		for (const line of lines) {
			if (isMatchLine(line)) {
				if (remainingMatches === 0) {
					truncated = true;
					break;
				}

				remainingMatches -= 1;
				numMatches += 1;
				const fileName = getMatchFile(line);

				if (fileName) {
					files.add(fileName);
				}
			}

			partialLines.push(line);
		}

		if (partialLines.length > 0) {
			keptBlocks.push(partialLines.join("\n"));
		}

		truncated = true;
		break;
	}

	return {
		output: keptBlocks.join("\n--\n"),
		numMatches,
		numFiles: files.size,
		truncated,
	};
}

function resolveSearchPath(
	inputPath: string | undefined,
	context: ToolContext,
): string {
	if (!inputPath) {
		return path.resolve(context.workspacePath);
	}

	return resolveSandboxedReadPath(inputPath, context);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function truncateText(
	text: string,
	maxLength: number,
): { text: string; truncated: boolean } {
	if (text.length <= maxLength) {
		return { text, truncated: false };
	}

	const safeLength = Math.max(0, maxLength - TRUNCATION_MARKER.length);
	return {
		text: `${text.slice(0, safeLength)}${TRUNCATION_MARKER}`,
		truncated: true,
	};
}

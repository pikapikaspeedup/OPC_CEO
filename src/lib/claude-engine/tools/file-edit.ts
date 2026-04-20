import * as fs from "node:fs/promises";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult, ValidationResult } from "../types";
import { resolveSandboxedReadPath, resolveSandboxedWritePath } from "./path-sandbox";

const inputSchema = z.object({
	file_path: z.string().describe("Absolute path to file"),
	old_string: z.string().describe("Exact text to find and replace"),
	new_string: z.string().describe("Replacement text"),
	replace_all: z.boolean().optional().default(false),
});

type Input = z.infer<typeof inputSchema>;

type FileEditMetadata = {
	filePath: string;
	matchCount: number;
	linesChanged: number;
	diff: string;
};

type FileEditResult = ToolResult<string> & {
	metadata: FileEditMetadata;
};

export const fileEditTool = {
	name: "FileEditTool",
	inputSchema,
	description: (input: Input) => `Edit file ${input.file_path}`,
	validateInput: async (input: Input): Promise<ValidationResult> => {
		if (input.old_string.length === 0) {
			return {
				valid: false,
				message: "old_string must not be empty",
			};
		}

		return { valid: true };
	},
	async call(args: Input, context: ToolContext): Promise<FileEditResult> {
		if (args.old_string.length === 0) {
			throw new Error("old_string must not be empty");
		}

		const filePath = resolveSandboxedReadPath(args.file_path, context);
		resolveSandboxedWritePath(args.file_path, context);

		let originalContent: string;

		try {
			originalContent = await fs.readFile(filePath, "utf8");
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				throw new Error(`File not found: ${filePath}`);
			}

			throw error;
		}
		const matchCount = countOccurrences(originalContent, args.old_string);

		if (matchCount === 0) {
			throw new Error("old_string not found");
		}

		if (matchCount > 1 && !args.replace_all) {
			throw new Error("Multiple matches, use replace_all");
		}

		const updatedContent = args.replace_all
			? originalContent.split(args.old_string).join(args.new_string)
			: originalContent.replace(args.old_string, args.new_string);
		const diffStats = computeLineDiffStats(originalContent, updatedContent);

		await fs.writeFile(filePath, updatedContent, "utf8");

		return {
			data: `Edited ${filePath}: replaced ${matchCount} occurrence(s)`,
			metadata: {
				filePath,
				matchCount,
				linesChanged: diffStats.linesAdded + diffStats.linesRemoved,
				diff: diffStats.diff,
			},
		};
	},
	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 10_000,
	getPath: (input: Input) => input.file_path,
	isDestructive: () => true,
} satisfies Tool<Input, string>;

function computeLineDiffStats(
	oldContent: string,
	newContent: string,
): { linesAdded: number; linesRemoved: number; diff: string } {
	const oldLines = splitLines(oldContent);
	const newLines = splitLines(newContent);
	let prefixLength = 0;

	while (
		prefixLength < oldLines.length &&
		prefixLength < newLines.length &&
		oldLines[prefixLength] === newLines[prefixLength]
	) {
		prefixLength += 1;
	}

	let suffixLength = 0;

	while (
		suffixLength < oldLines.length - prefixLength &&
		suffixLength < newLines.length - prefixLength &&
		oldLines[oldLines.length - 1 - suffixLength] ===
			newLines[newLines.length - 1 - suffixLength]
	) {
		suffixLength += 1;
	}

	const removedLines = oldLines.slice(
		prefixLength,
		oldLines.length - suffixLength,
	);
	const addedLines = newLines.slice(
		prefixLength,
		newLines.length - suffixLength,
	);
	const diffLines = [
		"--- before",
		"+++ after",
		`@@ -${prefixLength + 1},${removedLines.length} +${prefixLength + 1},${addedLines.length} @@`,
		...removedLines.map((line) => `-${line}`),
		...addedLines.map((line) => `+${line}`),
	];

	return {
		linesAdded: addedLines.length,
		linesRemoved: removedLines.length,
		diff: diffLines.join("\n"),
	};
}

function countOccurrences(content: string, needle: string): number {
	let count = 0;
	let startIndex = 0;

	while (startIndex <= content.length) {
		const foundIndex = content.indexOf(needle, startIndex);

		if (foundIndex === -1) {
			break;
		}

		count += 1;
		startIndex = foundIndex + needle.length;
	}

	return count;
}

function splitLines(content: string): string[] {
	if (content === "") {
		return [];
	}

	return content.split(/\r?\n/);
}

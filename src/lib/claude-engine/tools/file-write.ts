import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";
import { resolveSandboxedWritePath } from "./path-sandbox";

const inputSchema = z.object({
	file_path: z.string().describe("Absolute path to file"),
	content: z.string().describe("Complete file content"),
});

type Input = z.infer<typeof inputSchema>;

type FileWriteMetadata = {
	type: "create" | "update";
	filePath: string;
	linesAdded: number;
	linesRemoved: number;
	diff: string;
};

type FileWriteResult = ToolResult<string> & {
	metadata: FileWriteMetadata;
};

export const fileWriteTool = {
	name: "FileWriteTool",
	inputSchema,
	description: (input: Input) => `Write file ${input.file_path}`,
	async call(args: Input, context: ToolContext): Promise<FileWriteResult> {
		const filePath = resolveSandboxedWritePath(args.file_path, context);
		const previousContent = await readFileIfExists(filePath);
		const operationType = previousContent === null ? "create" : "update";
		const diffStats = computeLineDiffStats(previousContent ?? "", args.content);

		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, args.content, "utf8");

		return {
			data: `Wrote ${countLines(args.content)} lines to ${filePath}`,
			metadata: {
				type: operationType,
				filePath,
				linesAdded:
					operationType === "create"
						? countLines(args.content)
						: diffStats.linesAdded,
				linesRemoved: operationType === "create" ? 0 : diffStats.linesRemoved,
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

async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return null;
		}

		throw error;
	}
}

function countLines(content: string): number {
	return splitLines(content).length;
}

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

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function splitLines(content: string): string[] {
	if (content === "") {
		return [];
	}

	return content.split(/\r?\n/);
}

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	command: z.string().describe("Shell command to execute"),
	timeout: z
		.number()
		.optional()
		.default(60_000)
		.describe("Timeout in ms (max 300000)"),
	description: z.string().optional().describe("Human-readable description"),
});

type Input = z.infer<typeof inputSchema>;

type BashMetadata = {
	exitCode: number;
	stdout: string;
	stderr: string;
	truncated: boolean;
};

type BashResult = ToolResult<string> & {
	metadata: BashMetadata;
};

const MAX_TIMEOUT_MS = 300_000;
const TRUNCATION_MARKER = "\n...[truncated]";
const READ_ONLY_COMMANDS = new Set([
	"cat",
	"ls",
	"find",
	"grep",
	"head",
	"tail",
	"wc",
	"echo",
	"pwd",
	"env",
	"which",
	"type",
	"file",
	"stat",
	"du",
	"df",
	"uname",
	"date",
	"whoami",
]);
const WRITE_COMMANDS = new Set(["rm", "mv", "cp", "mkdir", "touch", "chmod"]);
const SHELL_OPERATOR_PATTERN = /[|<>]|&&|\|\||;/;
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/,
	/\brmdir\b/,
	/\btruncate\b/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+push\s+--force\b/,
	/\bgit\s+push\s+-f\b/,
];

export const bashTool = {
	name: "BashTool",
	inputSchema,
	description: (input: Input) =>
		input.description ?? `Execute shell command: ${input.command}`,
	async call(args: Input, context: ToolContext): Promise<BashResult> {
		const timeout = clampTimeout(args.timeout ?? 60_000);

		try {
			const result = await context.exec(args.command, {
				cwd: context.workspacePath,
				timeout,
			});
			const stdoutResult = truncateText(result.stdout, 15_000);
			const stderrResult = truncateText(result.stderr, 15_000);
			const combinedOutput = [stdoutResult.text, stderrResult.text]
				.filter(Boolean)
				.join("\n");
			const combinedResult = truncateText(combinedOutput, 30_000);

			return {
				data: combinedResult.text,
				metadata: {
					exitCode: result.exitCode,
					stdout: stdoutResult.text,
					stderr: stderrResult.text,
					truncated:
						combinedResult.truncated ||
						stdoutResult.truncated ||
						stderrResult.truncated,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const output = truncateText(message, 30_000);

			return {
				data: output.text,
				metadata: {
					exitCode: -1,
					stdout: "",
					stderr: output.text,
					truncated: output.truncated,
				},
			};
		}
	},
	isEnabled: () => true,
	isReadOnly: (input: Input) => isReadOnlyCommand(input.command),
	isConcurrencySafe: (input: Input) => isReadOnlyCommand(input.command),
	maxResultSizeChars: 30_000,
	isSearchOrReadCommand: (input: Input) => ({
		isSearch: isSearchCommand(input.command),
		isRead: isReadOnlyCommand(input.command),
		isList: isListCommand(input.command),
	}),
	isDestructive: (input: Input) =>
		DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(input.command)),
} satisfies Tool<Input, string>;

function clampTimeout(timeout: number): number {
	return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(timeout)));
}

function getPrimaryCommand(command: string): string {
	const tokens =
		command
			.trim()
			.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g)
			?.map((token) => token.replace(/^['"`]|['"`]$/g, "")) ?? [];

	while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
		tokens.shift();
	}

	return tokens[0] ?? "";
}

function isListCommand(command: string): boolean {
	return getPrimaryCommand(command) === "ls";
}

function isReadOnlyCommand(command: string): boolean {
	if (!command.trim()) {
		return false;
	}

	if (SHELL_OPERATOR_PATTERN.test(command)) {
		return false;
	}

	const primaryCommand = getPrimaryCommand(command);

	if (!primaryCommand || WRITE_COMMANDS.has(primaryCommand)) {
		return false;
	}

	return READ_ONLY_COMMANDS.has(primaryCommand);
}

function isSearchCommand(command: string): boolean {
	const primaryCommand = getPrimaryCommand(command);
	return primaryCommand === "find" || primaryCommand === "grep";
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

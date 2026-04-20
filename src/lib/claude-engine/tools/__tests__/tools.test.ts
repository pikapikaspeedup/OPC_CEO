import { exec as execCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import type { ExecResult, Tool, ToolContext } from "../../types";
import { bashTool } from "../bash";
import { fileEditTool } from "../file-edit";
import { fileReadTool } from "../file-read";
import { fileWriteTool } from "../file-write";
import { globTool } from "../glob";
import { grepTool } from "../grep";
import { resolveSandboxedPath } from "../path-sandbox";
import { createDefaultRegistry, ToolRegistry } from "../registry";

const execAsync = promisify(execCallback);

type ExecError = Error & {
	code?: number | string;
	stdout?: string;
	stderr?: string;
};

async function createTempDir(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createToolContext(
	workspacePath: string,
	execImpl?: ToolContext["exec"],
): ToolContext {
	return {
		workspacePath,
		abortSignal: new AbortController().signal,
		readFile: (filePath) => fs.readFile(filePath, "utf8"),
		writeFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
		exec:
			execImpl ??
			(async (cmd, opts) => {
				try {
					const result = await execAsync(cmd, {
						cwd: opts?.cwd,
						timeout: opts?.timeout,
						maxBuffer: 5_000_000,
					});

					return {
						stdout: result.stdout,
						stderr: result.stderr,
						exitCode: 0,
					} satisfies ExecResult;
				} catch (error) {
					const execError = error as ExecError;

					return {
						stdout: execError.stdout ?? "",
						stderr: execError.stderr ?? execError.message,
						exitCode: typeof execError.code === "number" ? execError.code : 1,
					} satisfies ExecResult;
				}
			}),
	};
}

function createDummyTool(options?: {
	name?: string;
	aliases?: string[];
	enabled?: boolean;
	readOnly?: boolean;
}): Tool<Record<string, unknown>> {
	return {
		name: options?.name ?? "DummyTool",
		aliases: options?.aliases,
		inputSchema: z.object({}).passthrough(),
		description: () => "dummy tool",
		call: async () => ({ data: "ok" }),
		isEnabled: () => options?.enabled ?? true,
		isReadOnly: () => options?.readOnly ?? true,
		isConcurrencySafe: () => true,
		maxResultSizeChars: 1_000,
	};
}

describe("ToolRegistry", () => {
	test("registers and retrieves tools", () => {
		const registry = new ToolRegistry();
		const tool = createDummyTool({ name: "AlphaTool" });

		registry.register(tool);

		expect(registry.get("AlphaTool")).toBe(tool);
		expect(registry.has("AlphaTool")).toBe(true);
		expect(registry.size).toBe(1);
	});

	test("finds by alias", () => {
		const registry = new ToolRegistry();
		const tool = createDummyTool({ name: "AlphaTool", aliases: ["alpha"] });

		registry.register(tool);

		expect(registry.get("alpha")).toBe(tool);
	});

	test("getEnabled filters disabled tools", () => {
		const registry = new ToolRegistry();

		registry.register(createDummyTool({ name: "EnabledTool", enabled: true }));
		registry.register(
			createDummyTool({ name: "DisabledTool", enabled: false }),
		);

		expect(registry.getEnabled().map((tool) => tool.name)).toEqual([
			"EnabledTool",
		]);
	});

	test("createDefaultRegistry registers all tools", () => {
		const registry = createDefaultRegistry();

		expect(
			registry
				.getAll()
				.map((tool) => tool.name)
				.sort(),
		).toEqual([
			"AgentTool",
			"AskUserQuestionTool",
			"BashTool",
			"ConfigTool",
			"EnterPlanModeTool",
			"ExitPlanModeTool",
			"FileEditTool",
			"FileReadTool",
			"FileWriteTool",
			"GlobTool",
			"GrepTool",
			"ListMcpResourcesTool",
			"NotebookEditTool",
			"ReadMcpResourceTool",
			"SessionSearchTool",
			"SkillManageTool",
			"SkillTool",
			"TaskCreateTool",
			"TaskGetTool",
			"TaskListTool",
			"TaskUpdateTool",
			"TodoWriteTool",
			"ToolSearchTool",
			"VerifyPlanExecutionTool",
			"WebFetchTool",
			"WebSearchTool",
		]);
		expect(registry.size).toBe(26);
	});
});

describe("FileReadTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-read-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("reads file content with line numbers", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha\nbeta\n", "utf8");

		const result = await fileReadTool.call(
			{ file_path: filePath },
			createToolContext(tempDir),
		);

		expect(result.data).toBe("1: alpha\n2: beta\n3: ");
		expect(result.metadata).toEqual({
			filePath,
			numLines: 3,
			startLine: 1,
			totalLines: 3,
		});
	});

	test("respects offset and limit", async () => {
		const filePath = path.join(tempDir, "note.txt");
		await fs.writeFile(filePath, "alpha\nbeta\ngamma", "utf8");

		const result = await fileReadTool.call(
			{ file_path: filePath, offset: 2, limit: 1 },
			createToolContext(tempDir),
		);

		expect(result.data).toBe("2: beta");
		expect(result.metadata.startLine).toBe(2);
		expect(result.metadata.numLines).toBe(1);
	});

	test("errors on non-existent file", async () => {
		await expect(
			fileReadTool.call(
				{ file_path: path.join(tempDir, "missing.txt") },
				createToolContext(tempDir),
			),
		).rejects.toThrow("File not found");
	});
});

describe("FileWriteTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-write-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("creates new file", async () => {
		const filePath = path.join(tempDir, "created.txt");

		const result = await fileWriteTool.call(
			{ file_path: filePath, content: "alpha\nbeta" },
			createToolContext(tempDir),
		);

		expect(await fs.readFile(filePath, "utf8")).toBe("alpha\nbeta");
		expect(result.data).toBe(`Wrote 2 lines to ${filePath}`);
		expect(result.metadata.type).toBe("create");
	});

	test("overwrites existing file", async () => {
		const filePath = path.join(tempDir, "existing.txt");
		await fs.writeFile(filePath, "old\ncontent", "utf8");

		const result = await fileWriteTool.call(
			{ file_path: filePath, content: "new\ncontent\nhere" },
			createToolContext(tempDir),
		);

		expect(await fs.readFile(filePath, "utf8")).toBe("new\ncontent\nhere");
		expect(result.metadata.type).toBe("update");
		expect(result.metadata.linesAdded).toBeGreaterThan(0);
		expect(result.metadata.linesRemoved).toBeGreaterThan(0);
	});

	test("creates parent directories", async () => {
		const filePath = path.join(tempDir, "nested", "dir", "created.txt");

		await fileWriteTool.call(
			{ file_path: filePath, content: "hello" },
			createToolContext(tempDir),
		);

		expect(await fs.readFile(filePath, "utf8")).toBe("hello");
	});
});

describe("FileEditTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-edit-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("replaces single occurrence", async () => {
		const filePath = path.join(tempDir, "edit.txt");
		await fs.writeFile(filePath, "hello world", "utf8");

		const result = await fileEditTool.call(
			{
				file_path: filePath,
				old_string: "world",
				new_string: "cat",
			},
			createToolContext(tempDir),
		);

		expect(await fs.readFile(filePath, "utf8")).toBe("hello cat");
		expect(result.metadata.matchCount).toBe(1);
	});

	test("errors when old_string not found", async () => {
		const filePath = path.join(tempDir, "edit.txt");
		await fs.writeFile(filePath, "hello world", "utf8");

		await expect(
			fileEditTool.call(
				{
					file_path: filePath,
					old_string: "missing",
					new_string: "cat",
				},
				createToolContext(tempDir),
			),
		).rejects.toThrow("old_string not found");
	});

	test("errors on multiple matches without replace_all", async () => {
		const filePath = path.join(tempDir, "edit.txt");
		await fs.writeFile(filePath, "cat\ncat\ncat", "utf8");

		await expect(
			fileEditTool.call(
				{
					file_path: filePath,
					old_string: "cat",
					new_string: "dog",
				},
				createToolContext(tempDir),
			),
		).rejects.toThrow("Multiple matches, use replace_all");
	});

	test("replace_all replaces all occurrences", async () => {
		const filePath = path.join(tempDir, "edit.txt");
		await fs.writeFile(filePath, "cat\ncat\ncat", "utf8");

		const result = await fileEditTool.call(
			{
				file_path: filePath,
				old_string: "cat",
				new_string: "dog",
				replace_all: true,
			},
			createToolContext(tempDir),
		);

		expect(await fs.readFile(filePath, "utf8")).toBe("dog\ndog\ndog");
		expect(result.metadata.matchCount).toBe(3);
	});
});

describe("BashTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-bash-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("executes command and returns output", async () => {
		const result = await bashTool.call(
			{ command: "printf 'hello'", description: "print hello" },
			createToolContext(tempDir),
		);

		expect(result.data).toContain("hello");
		expect(result.metadata.exitCode).toBe(0);
	});

	test("handles command timeout", async () => {
		const result = await bashTool.call(
			{ command: "long-running", timeout: 10 },
			createToolContext(tempDir, async () => {
				throw new Error("Command timed out after 10ms");
			}),
		);

		expect(result.data).toContain("Command timed out");
		expect(result.metadata.exitCode).toBe(-1);
	});

	test("isReadOnly detects read-only commands", () => {
		expect(bashTool.isReadOnly({ command: "ls src", timeout: 1000 })).toBe(
			true,
		);
		expect(bashTool.isReadOnly({ command: "pwd", timeout: 1000 })).toBe(true);
		expect(bashTool.isReadOnly({ command: "rm file.txt", timeout: 1000 })).toBe(
			false,
		);
		expect(
			bashTool.isReadOnly({ command: "cat file.txt | wc -l", timeout: 1000 }),
		).toBe(false);
	});
});

describe("GlobTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-glob-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("finds files matching pattern", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
		await fs.writeFile(path.join(tempDir, "src", "a.ts"), "", "utf8");
		await fs.writeFile(path.join(tempDir, "src", "b.ts"), "", "utf8");
		await fs.writeFile(path.join(tempDir, "src", "c.js"), "", "utf8");

		const result = await globTool.call(
			{ pattern: "src/**/*.ts" },
			createToolContext(tempDir),
		);

		expect(result.data).toBe("src/a.ts\nsrc/b.ts");
		expect(result.metadata.numFiles).toBe(2);
	});

	test("respects base path", async () => {
		await fs.mkdir(path.join(tempDir, "nested", "sub"), { recursive: true });
		await fs.writeFile(path.join(tempDir, "nested", "sub", "a.ts"), "", "utf8");
		await fs.writeFile(path.join(tempDir, "nested", "b.ts"), "", "utf8");

		const result = await globTool.call(
			{ pattern: "*.ts", path: path.join(tempDir, "nested") },
			createToolContext(tempDir),
		);

		expect(result.data).toBe("b.ts");
	});

	test("truncates at limit", async () => {
		await fs.mkdir(path.join(tempDir, "many"), { recursive: true });

		await Promise.all(
			Array.from({ length: 205 }, (_, index) =>
				fs.writeFile(
					path.join(
						tempDir,
						"many",
						`file-${String(index).padStart(3, "0")}.ts`,
					),
					"",
					"utf8",
				),
			),
		);

		const result = await globTool.call(
			{ pattern: "many/*.ts" },
			createToolContext(tempDir),
		);

		expect(result.data.split("\n")).toHaveLength(200);
		expect(result.metadata.truncated).toBe(true);
	});
});

describe("GrepTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-tools-grep-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("finds pattern in files", async () => {
		const filePath = path.join(tempDir, "notes.txt");
		await fs.writeFile(filePath, "alpha\nbeta match\ngamma", "utf8");

		const result = await grepTool.call(
			{ pattern: "match" },
			createToolContext(tempDir),
		);

		expect(result.data).toContain("notes.txt:2:beta match");
		expect(result.metadata.numMatches).toBe(1);
	});

	test("respects case sensitivity", async () => {
		const filePath = path.join(tempDir, "notes.txt");
		await fs.writeFile(filePath, "Hello World", "utf8");

		const sensitive = await grepTool.call(
			{ pattern: "hello", case_sensitive: true },
			createToolContext(tempDir),
		);
		const insensitive = await grepTool.call(
			{ pattern: "hello", case_sensitive: false },
			createToolContext(tempDir),
		);

		expect(sensitive.data).toBe("");
		expect(insensitive.data).toContain("Hello World");
	});

	test("respects context lines", async () => {
		const filePath = path.join(tempDir, "notes.txt");
		await fs.writeFile(
			filePath,
			["line 1", "line 2", "target line", "line 4", "line 5"].join("\n"),
			"utf8",
		);

		const result = await grepTool.call(
			{ pattern: "target", context_lines: 1 },
			createToolContext(tempDir),
		);

		expect(result.data).toContain("notes.txt-2-line 2");
		expect(result.data).toContain("notes.txt:3:target line");
		expect(result.data).toContain("notes.txt-4-line 4");
	});
});

// =============================================================================
// Security regression tests
// =============================================================================

describe("Path Sandbox", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-sandbox-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("allows paths within workspace", () => {
		const context = createToolContext(tempDir);
		const resolved = resolveSandboxedPath("subdir/file.txt", context);
		expect(resolved).toBe(path.resolve(tempDir, "subdir/file.txt"));
	});

	test("blocks path traversal with ../", () => {
		const context = createToolContext(tempDir);
		expect(() =>
			resolveSandboxedPath("../../../etc/passwd", context),
		).toThrow("Path traversal denied");
	});

	test("blocks absolute path outside workspace", () => {
		const context = createToolContext(tempDir);
		expect(() => resolveSandboxedPath("/etc/passwd", context)).toThrow(
			"Path traversal denied",
		);
	});

	test("allows paths in additionalWorkingDirectories", () => {
		const extraDir = path.join(os.tmpdir(), "extra-allowed");
		const context: ToolContext = {
			...createToolContext(tempDir),
			additionalWorkingDirectories: [extraDir],
		};
		const resolved = resolveSandboxedPath(
			path.join(extraDir, "file.txt"),
			context,
		);
		expect(resolved).toBe(path.resolve(extraDir, "file.txt"));
	});
});

describe("FileReadTool - Security", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-read-sec-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("blocks reading files outside workspace", async () => {
		await expect(
			fileReadTool.call(
				{ file_path: "/etc/passwd" },
				createToolContext(tempDir),
			),
		).rejects.toThrow("Path traversal denied");
	});

	test("blocks ../traversal", async () => {
		await expect(
			fileReadTool.call(
				{ file_path: "../../../etc/passwd" },
				createToolContext(tempDir),
			),
		).rejects.toThrow("Path traversal denied");
	});
});

describe("FileWriteTool - Security", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-write-sec-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("blocks writing files outside workspace", async () => {
		await expect(
			fileWriteTool.call(
				{ file_path: "/tmp/outside-attack.txt", content: "hacked" },
				createToolContext(tempDir),
			),
		).rejects.toThrow("Path traversal denied");
	});
});

describe("FileEditTool - Security", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-edit-sec-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("blocks editing files outside workspace", async () => {
		await expect(
			fileEditTool.call(
				{
					file_path: "/etc/hosts",
					old_string: "localhost",
					new_string: "hacked",
				},
				createToolContext(tempDir),
			),
		).rejects.toThrow("Path traversal denied");
	});

	test("errors on non-existent file with clear message", async () => {
		await expect(
			fileEditTool.call(
				{
					file_path: path.join(tempDir, "missing.txt"),
					old_string: "hello",
					new_string: "world",
				},
				createToolContext(tempDir),
			),
		).rejects.toThrow("File not found");
	});
});

describe("GrepTool - Validation", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await createTempDir("claude-engine-grep-val-");
	});

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("rejects overly long patterns", async () => {
		const longPattern = "a".repeat(1001);
		const result = await grepTool.validateInput!(
			{ pattern: longPattern },
			createToolContext(tempDir),
		);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.message).toContain("Pattern too long");
		}
	});

	test("rejects dangerous regex constructs", async () => {
		const result = await grepTool.validateInput!(
			{ pattern: "(.*){100}" },
			createToolContext(tempDir),
		);
		expect(result.valid).toBe(false);
	});

	test("accepts valid patterns", async () => {
		const result = await grepTool.validateInput!(
			{ pattern: "function\\s+\\w+" },
			createToolContext(tempDir),
		);
		expect(result.valid).toBe(true);
	});
});

describe("Registry - ReadOnly filter", () => {
	test("getReadOnly does not crash on input-dependent tools", () => {
		const registry = createDefaultRegistry();
		// Should not throw when BashTool.isReadOnly receives empty input
		const readOnlyTools = registry.getReadOnly();
		// FileRead, Glob, Grep are always readOnly
		const names = readOnlyTools.map((t) => t.name).sort();
		expect(names).toContain("FileReadTool");
		expect(names).toContain("GlobTool");
		expect(names).toContain("GrepTool");
		// BashTool, FileWriteTool, FileEditTool are NOT always readOnly
		expect(names).not.toContain("FileWriteTool");
		expect(names).not.toContain("FileEditTool");
	});
});

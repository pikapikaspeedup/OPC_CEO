/**
 * Tests for new tools:
 * - AskUserQuestionTool
 * - AgentTool
 * - SkillTool
 * - TaskCreate/Update/List/Get
 * - WebFetchTool
 * - WebSearchTool
 * - TodoWriteTool
 * - NotebookEditTool
 * - ToolSearchTool
 * - ConfigTool
 * - PlanMode tools
 * - MCP Resource tools
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { askUserQuestionTool } from "../ask-user";
import {
	agentTool,
	type AgentSpawnHandler,
	setAgentHandler,
	clearAgentHandler,
	bindAgentHandler,
	unbindAgentHandler,
} from "../agent";
import { skillTool } from "../skill";
import {
	taskCreateTool,
	taskUpdateTool,
	taskListTool,
	taskGetTool,
	clearTasks,
} from "../task";
import { webFetchTool } from "../web-fetch";
import { webSearchTool } from "../web-search";
import { todoWriteTool, getTodos, clearTodos } from "../todo-write";
import { notebookEditTool } from "../notebook-edit";
import { toolSearchTool, setToolSearchRegistry } from "../tool-search";
import { configTool, getConfigValue, setConfigValue, resetConfig } from "../config";
import {
	enterPlanModeTool,
	exitPlanModeTool,
	verifyPlanExecutionTool,
	isPlanMode,
	clearPlanState,
} from "../plan-mode";
import {
	listMcpResourcesTool,
	readMcpResourceTool,
	setMcpResourceProvider,
	clearMcpResourceProvider,
	bindMcpResourceProvider,
	unbindMcpResourceProvider,
} from "../mcp-resources";
import type { ToolContext } from "../../types";

function createContext(workspacePath: string): ToolContext {
	return {
		workspacePath,
		abortSignal: new AbortController().signal,
		readFile: (p) => fs.readFile(p, "utf8"),
		writeFile: (p, c) => fs.writeFile(p, c, "utf8"),
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
	};
}

// ─── AskUserQuestionTool ────────────────────────────────────────────

describe("AskUserQuestionTool", () => {
	test("has correct name", () => {
		expect(askUserQuestionTool.name).toBe("AskUserQuestionTool");
	});

	test("description is a function", () => {
		const desc = askUserQuestionTool.description({
			questions: [{ question: "Pick one", header: "Choice" }],
		} as any);
		expect(typeof desc).toBe("string");
	});

	test("returns output with needsUserInput=true for unanswered questions", async () => {
		const result = await askUserQuestionTool.call({
			questions: [{ question: "What color?", header: "Color" }],
		});
		const parsed = JSON.parse(result.data);
		expect(parsed.needsUserInput).toBe(true);
		expect(parsed.questions).toHaveLength(1);
	});

	test("returns needsUserInput=false when all answered", async () => {
		const result = await askUserQuestionTool.call({
			questions: [{ question: "What color?", header: "Color" }],
			answers: { Color: "blue" },
		});
		const parsed = JSON.parse(result.data);
		expect(parsed.needsUserInput).toBe(false);
		expect(parsed.answers.Color).toBe("blue");
	});
});

// ─── AgentTool ──────────────────────────────────────────────────────

describe("AgentTool", () => {
	const ctx = createContext("/tmp/test");

	afterEach(() => {
		clearAgentHandler();
	});

	test("has correct name", () => {
		expect(agentTool.name).toBe("AgentTool");
	});

	test("returns no_handler when no handler is set", async () => {
		const result = await agentTool.call(
			{ prompt: "do something useful for the project" },
			ctx,
		);
		const parsed = JSON.parse(result.data);
		expect(parsed.status).toBe("no_handler");
	});

	test("delegates to handler when set", async () => {
		const handler: AgentSpawnHandler = async (req) => {
			return "Completed: " + req.prompt.slice(0, 20);
		};
		setAgentHandler(handler);

		const result = await agentTool.call(
			{ prompt: "write unit tests for auth module" },
			ctx,
		);
		expect(result.data).toBe("Completed: write unit tests for");
	});

	test("passes all fields to handler", async () => {
		let captured: any;
		setAgentHandler(async (req) => {
			captured = req;
			return "ok";
		});

		await agentTool.call(
			{
				prompt: "review the PR for security issues",
				agentType: "reviewer",
				timeout: 60,
			},
			ctx,
		);

		expect(captured.prompt).toBe("review the PR for security issues");
		expect(captured.agentType).toBe("reviewer");
		expect(captured.timeout).toBe(60);
	});

	test("prefers context-bound handler over global handler", async () => {
		const scopedContext = createContext("/tmp/scoped-agent");
		setAgentHandler(async () => "global");
		bindAgentHandler(scopedContext, async () => "scoped");

		try {
			const result = await agentTool.call(
				{ prompt: "investigate dependency updates in this repo" },
				scopedContext,
			);
			expect(result.data).toBe("scoped");
		} finally {
			unbindAgentHandler(scopedContext);
		}
	});
});

// ─── SkillTool ──────────────────────────────────────────────────────

describe("SkillTool", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
	});

	afterEach(async () => {
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("has correct name", () => {
		expect(skillTool.name).toBe("SkillTool");
	});

	test("returns no skills found for missing skill", async () => {
		const result = await skillTool.call(
			{ skillName: "nonexistent", skillDirs: [tempDir] },
			createContext(tempDir),
		);
		expect(result.data).toContain("No skills found");
	});

	test("finds a skill by name", async () => {
		const skillDir = path.join(tempDir, "test-skill");
		await fs.mkdir(skillDir, { recursive: true });
		await fs.writeFile(
			path.join(skillDir, "SKILL.md"),
			"# Test Skill\nThis is a test skill.",
		);

		const result = await skillTool.call(
			{ skillName: "test-skill", skillDirs: [tempDir] },
			createContext(tempDir),
		);
		expect(result.data).toContain("Test Skill");
		expect(result.data).toContain("This is a test skill");
	});
});

// ─── TaskTools ──────────────────────────────────────────────────────

describe("TaskTools", () => {
	beforeEach(() => {
		clearTasks();
	});

	test("TaskCreateTool creates a task", async () => {
		const result = await taskCreateTool.call({
			subject: "Fix bug #123",
			description: "Fix the login issue",
		});
		const parsed = JSON.parse(result.data);
		expect(parsed.subject).toBe("Fix bug #123");
		expect(parsed.status).toBe("pending");
		expect(parsed.id).toBeDefined();
	});

	test("TaskListTool lists tasks", async () => {
		await taskCreateTool.call({ subject: "Task A", description: "desc A" });
		await taskCreateTool.call({ subject: "Task B", description: "desc B" });

		const result = await taskListTool.call({});
		expect(result.data).toContain("Tasks (2)");
		expect(result.data).toContain("Task A");
		expect(result.data).toContain("Task B");
	});

	test("TaskUpdateTool updates task status", async () => {
		const createResult = JSON.parse(
			(await taskCreateTool.call({ subject: "Task X", description: "d" })).data,
		);
		const id = createResult.id;

		const updateResult = await taskUpdateTool.call({
			id,
			status: "completed",
		});
		const parsed = JSON.parse(updateResult.data);
		expect(parsed.status).toBe("completed");
	});

	test("TaskGetTool gets a specific task", async () => {
		const createResult = JSON.parse(
			(await taskCreateTool.call({ subject: "Task Y", description: "desc" })).data,
		);
		const id = createResult.id;

		const getResult = await taskGetTool.call({ id });
		const parsed = JSON.parse(getResult.data);
		expect(parsed.subject).toBe("Task Y");
		expect(parsed.description).toBe("desc");
	});

	test("TaskGetTool throws for unknown ID", async () => {
		await expect(
			taskGetTool.call({ id: "nonexistent" }),
		).rejects.toThrow("not found");
	});

	test("TaskUpdateTool throws for unknown ID", async () => {
		await expect(
			taskUpdateTool.call({ id: "nonexistent", status: "completed" }),
		).rejects.toThrow("not found");
	});

	test("TaskListTool filters by status", async () => {
		await taskCreateTool.call({ subject: "A", description: "d" });
		const bResult = JSON.parse(
			(await taskCreateTool.call({ subject: "B", description: "d" })).data,
		);
		await taskUpdateTool.call({ id: bResult.id, status: "completed" });

		const result = await taskListTool.call({ status: "pending" });
		expect(result.data).toContain("Tasks (1)");
		expect(result.data).toContain("A");
		expect(result.data).not.toContain(": B");
	});

	test("clearTasks resets store", async () => {
		await taskCreateTool.call({ subject: "A", description: "d" });
		await taskCreateTool.call({ subject: "B", description: "d" });
		clearTasks();

		const result = await taskListTool.call({});
		expect(result.data).toContain("No tasks found");
	});
});

// ─── WebFetchTool ───────────────────────────────────────────────────

describe("WebFetchTool", () => {
	test("has correct name", () => {
		expect(webFetchTool.name).toBe("WebFetchTool");
	});

	test("has url in input schema", () => {
		const jsonSchema = webFetchTool.inputJSONSchema;
		expect(jsonSchema.properties).toHaveProperty("url");
		expect(jsonSchema.required).toContain("url");
	});

	test("isReadOnly returns true", () => {
		expect(webFetchTool.isReadOnly()).toBe(true);
	});

	test("isConcurrencySafe returns true", () => {
		expect(webFetchTool.isConcurrencySafe()).toBe(true);
	});
});

// ─── WebSearchTool ──────────────────────────────────────────────────

describe("WebSearchTool", () => {
	test("has correct name", () => {
		expect(webSearchTool.name).toBe("WebSearchTool");
	});

	test("has query in input schema", () => {
		const jsonSchema = webSearchTool.inputJSONSchema;
		expect(jsonSchema.properties).toHaveProperty("query");
		expect(jsonSchema.required).toContain("query");
	});

	test("isEnabled returns false when no API key is set", () => {
		const origTavily = process.env.TAVILY_API_KEY;
		const origBrave = process.env.BRAVE_SEARCH_API_KEY;
		const origKagi = process.env.KAGI_API_KEY;
		delete process.env.TAVILY_API_KEY;
		delete process.env.BRAVE_SEARCH_API_KEY;
		delete process.env.KAGI_API_KEY;

		expect(webSearchTool.isEnabled()).toBe(false);

		if (origTavily) process.env.TAVILY_API_KEY = origTavily;
		if (origBrave) process.env.BRAVE_SEARCH_API_KEY = origBrave;
		if (origKagi) process.env.KAGI_API_KEY = origKagi;
	});

	test("isEnabled returns true when an API key is set", () => {
		const orig = process.env.TAVILY_API_KEY;
		process.env.TAVILY_API_KEY = "test-key";

		expect(webSearchTool.isEnabled()).toBe(true);

		if (orig) {
			process.env.TAVILY_API_KEY = orig;
		} else {
			delete process.env.TAVILY_API_KEY;
		}
	});
});

// ─── Registry size ──────────────────────────────────────────────────

describe("Tool registry completeness", () => {
	const ALL_TOOLS = [
		askUserQuestionTool,
		agentTool,
		skillTool,
		taskCreateTool,
		taskUpdateTool,
		taskListTool,
		taskGetTool,
		webFetchTool,
		webSearchTool,
		todoWriteTool,
		notebookEditTool,
		toolSearchTool,
		configTool,
		enterPlanModeTool,
		exitPlanModeTool,
		verifyPlanExecutionTool,
		listMcpResourcesTool,
		readMcpResourceTool,
	];

	test("all new tools have unique names", () => {
		const names = ALL_TOOLS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("all tools have inputSchema and inputJSONSchema", () => {
		for (const tool of ALL_TOOLS) {
			expect(tool.inputSchema).toBeDefined();
			expect(tool.inputJSONSchema).toBeDefined();
			expect(tool.inputJSONSchema.type).toBe("object");
			expect(tool.inputJSONSchema.properties).toBeDefined();
		}
	});

	test("all tools have required interface methods", () => {
		for (const tool of ALL_TOOLS) {
			expect(typeof tool.call).toBe("function");
			expect(typeof tool.isEnabled).toBe("function");
			expect(typeof tool.isReadOnly).toBe("function");
			expect(typeof tool.isConcurrencySafe).toBe("function");
			expect(typeof tool.description).toBe("function");
		}
	});
});

// ─── TodoWriteTool ──────────────────────────────────────────────────

describe("TodoWriteTool", () => {
	beforeEach(() => clearTodos());
	afterEach(() => clearTodos());

	test("has correct name", () => {
		expect(todoWriteTool.name).toBe("TodoWriteTool");
	});

	test("creates todos and returns summary", async () => {
		const result = await todoWriteTool.call({
			todos: [
				{ id: "1", title: "Task A", status: "not-started" },
				{ id: "2", title: "Task B", status: "in-progress" },
			],
		});
		const data = JSON.parse(result.data);
		expect(data.total).toBe(2);
		expect(data.inProgress).toBe(1);
		expect(data.completed).toBe(0);
	});

	test("tracks additions and removals", async () => {
		await todoWriteTool.call({
			todos: [
				{ id: "1", title: "A", status: "not-started" },
				{ id: "2", title: "B", status: "not-started" },
			],
		});

		const result = await todoWriteTool.call({
			todos: [
				{ id: "1", title: "A", status: "completed" },
				{ id: "3", title: "C", status: "not-started" },
			],
		});
		const data = JSON.parse(result.data);
		expect(data.added).toBe(1); // C added
		expect(data.removed).toBe(1); // B removed
		expect(data.completed).toBe(1);
	});

	test("getTodos returns current state", async () => {
		await todoWriteTool.call({
			todos: [{ id: "1", title: "A", status: "not-started" }],
		});
		const todos = getTodos();
		expect(todos).toHaveLength(1);
		expect(todos[0].title).toBe("A");
	});
});

// ─── NotebookEditTool ───────────────────────────────────────────────

describe("NotebookEditTool", () => {
	let tempDir = "";
	let ctx: ToolContext;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "notebook-test-"));
		ctx = createContext(tempDir);
	});

	afterEach(async () => {
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("has correct name", () => {
		expect(notebookEditTool.name).toBe("NotebookEditTool");
	});

	test("inserts cell into notebook", async () => {
		const nb = {
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [],
		};
		const nbPath = path.join(tempDir, "test.ipynb");
		await fs.writeFile(nbPath, JSON.stringify(nb));

		const result = await notebookEditTool.call(
			{
				notebook_path: "test.ipynb",
				command: "insert",
				new_source: "print('hello')",
			},
			ctx,
		);
		expect(result.data).toContain("Inserted code cell");

		const updated = JSON.parse(await fs.readFile(nbPath, "utf8"));
		expect(updated.cells).toHaveLength(1);
		expect(updated.cells[0].cell_type).toBe("code");
	});

	test("edits existing cell", async () => {
		const nb = {
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [
				{
					id: "cell-1",
					cell_type: "code",
					source: ["old code"],
					metadata: {},
					outputs: [],
					execution_count: 5,
				},
			],
		};
		const nbPath = path.join(tempDir, "test.ipynb");
		await fs.writeFile(nbPath, JSON.stringify(nb));

		const result = await notebookEditTool.call(
			{
				notebook_path: "test.ipynb",
				command: "edit",
				cell_id: "cell-1",
				new_source: "new code",
			},
			ctx,
		);
		expect(result.data).toContain("Edited cell cell-1");

		const updated = JSON.parse(await fs.readFile(nbPath, "utf8"));
		expect(updated.cells[0].source).toEqual(["new code"]);
		expect(updated.cells[0].execution_count).toBeNull();
	});

	test("deletes cell", async () => {
		const nb = {
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [
				{ id: "c1", cell_type: "code", source: ["a"], metadata: {} },
				{ id: "c2", cell_type: "code", source: ["b"], metadata: {} },
			],
		};
		const nbPath = path.join(tempDir, "test.ipynb");
		await fs.writeFile(nbPath, JSON.stringify(nb));

		const result = await notebookEditTool.call(
			{ notebook_path: "test.ipynb", command: "delete", cell_id: "c1" },
			ctx,
		);
		expect(result.data).toContain("Deleted cell c1");

		const updated = JSON.parse(await fs.readFile(nbPath, "utf8"));
		expect(updated.cells).toHaveLength(1);
		expect(updated.cells[0].id).toBe("c2");
	});

	test("rejects path traversal", async () => {
		await expect(
			notebookEditTool.call(
				{
					notebook_path: "/etc/passwd",
					command: "insert",
					new_source: "x",
				},
				ctx,
			),
		).rejects.toThrow(/traversal/i);
	});
});

// ─── ToolSearchTool ─────────────────────────────────────────────────

describe("ToolSearchTool", () => {
	beforeEach(() => {
		setToolSearchRegistry([
			{
				name: "FileReadTool",
				aliases: ["read_file"],
				description: () => "Read a file from the filesystem",
				isReadOnly: () => true,
				isEnabled: () => true,
			},
			{
				name: "BashTool",
				aliases: ["bash", "shell"],
				description: () => "Execute a bash command",
				isReadOnly: () => false,
				isEnabled: () => true,
			},
			{
				name: "GrepTool",
				aliases: ["grep"],
				description: () => "Search file contents using regex",
				isReadOnly: () => true,
				isEnabled: () => true,
			},
		]);
	});

	afterEach(() => setToolSearchRegistry([]));

	test("has correct name", () => {
		expect(toolSearchTool.name).toBe("ToolSearchTool");
	});

	test("finds tools matching query", async () => {
		const result = await toolSearchTool.call({ query: "read file" });
		expect(result.data).toContain("FileReadTool");
	});

	test("returns all tools when no match", async () => {
		const result = await toolSearchTool.call({ query: "quantum entangle xyz" });
		expect(result.data).toContain("No tools matched");
		expect(result.data).toContain("FileReadTool");
	});

	test("isReadOnly returns true", () => {
		expect(toolSearchTool.isReadOnly()).toBe(true);
	});
});

// ─── ConfigTool ─────────────────────────────────────────────────────

describe("ConfigTool", () => {
	beforeEach(() => resetConfig());
	afterEach(() => resetConfig());

	test("has correct name", () => {
		expect(configTool.name).toBe("ConfigTool");
	});

	test("list returns all settings", async () => {
		const result = await configTool.call({ action: "list" });
		expect(result.data).toContain("model");
		expect(result.data).toContain("maxTokens");
		expect(result.data).toContain("[default]");
	});

	test("get returns specific setting", async () => {
		const result = await configTool.call({ action: "get", key: "model" });
		const data = JSON.parse(result.data);
		expect(data.key).toBe("model");
		expect(data.isDefault).toBe(true);
	});

	test("set updates value", async () => {
		await configTool.call({ action: "set", key: "verbose", value: true });
		expect(getConfigValue("verbose")).toBe(true);
	});

	test("set validates value", async () => {
		const result = await configTool.call({
			action: "set",
			key: "temperature",
			value: 999,
		});
		expect(result.data).toContain("Invalid");
	});

	test("reset restores defaults", async () => {
		await configTool.call({ action: "set", key: "verbose", value: true });
		await configTool.call({ action: "reset" });
		expect(getConfigValue("verbose")).toBe(false);
	});
});

// ─── PlanMode Tools ─────────────────────────────────────────────────

describe("PlanMode Tools", () => {
	let tempDir = "";
	let ctx: ToolContext;

	beforeEach(async () => {
		clearPlanState();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-test-"));
		ctx = createContext(tempDir);
	});

	afterEach(async () => {
		clearPlanState();
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("enter/exit plan mode lifecycle", async () => {
		expect(isPlanMode()).toBe(false);

		const enterResult = await enterPlanModeTool.call({});
		expect(enterResult.data).toContain("Entered plan mode");
		expect(isPlanMode()).toBe(true);

		const exitResult = await exitPlanModeTool.call(
			{ plan: "# My Plan\n1. Do X\n2. Do Y" },
			ctx,
		);
		expect(exitResult.data).toContain("Exited plan mode");
		expect(exitResult.data).toContain("3 lines");
		expect(isPlanMode()).toBe(false);

		// Verify plan file was saved
		const planDir = path.join(tempDir, ".claude", "plans");
		const files = await fs.readdir(planDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^plan-.*\.md$/);
	});

	test("enter when already in plan mode", async () => {
		await enterPlanModeTool.call({});
		const result = await enterPlanModeTool.call({});
		expect(result.data).toContain("Already in plan mode");
	});

	test("exit when not in plan mode", async () => {
		const result = await exitPlanModeTool.call({}, ctx);
		expect(result.data).toContain("Not in plan mode");
	});

	test("verify plan execution", async () => {
		const result = await verifyPlanExecutionTool.call({
			planSummary: "Refactor auth module",
			completedSteps: ["Extract types", "Write tests"],
			remainingSteps: ["Implement logic"],
		});
		expect(result.data).toContain("67%");
		expect(result.data).toContain("[x] Extract types");
		expect(result.data).toContain("[ ] Implement logic");
	});
});

// ─── MCP Resource Tools ─────────────────────────────────────────────

describe("MCP Resource Tools", () => {
	afterEach(() => clearMcpResourceProvider());

	test("listMcpResourcesTool remains available without provider", () => {
		expect(listMcpResourcesTool.isEnabled()).toBe(true);
	});

	test("readMcpResourceTool remains available without provider", () => {
		expect(readMcpResourceTool.isEnabled()).toBe(true);
	});

	test("listMcpResourcesTool returns resources", async () => {
		setMcpResourceProvider({
			listResources: async () => [
				{
					uri: "file:///test.md",
					name: "test.md",
					server: "local",
					description: "A test file",
				},
			],
			readResource: async () => [],
			getServerNames: () => ["local"],
		});

			expect(listMcpResourcesTool.isEnabled()).toBe(true);
			const result = await listMcpResourcesTool.call({}, createContext("/tmp/mcp-global"));
		expect(result.data).toContain("test.md");
		expect(result.data).toContain("local");
	});

	test("readMcpResourceTool reads content", async () => {
		setMcpResourceProvider({
			listResources: async () => [],
			readResource: async () => [
				{ type: "text" as const, text: "Hello from MCP!" },
			],
			getServerNames: () => ["my-server"],
		});

			const result = await readMcpResourceTool.call(
				{
					server: "my-server",
					uri: "file:///test.txt",
				},
				createContext("/tmp/mcp-global"),
			);
			expect(result.data).toContain("Hello from MCP!");
		});

	test("readMcpResourceTool rejects unknown server", async () => {
		setMcpResourceProvider({
			listResources: async () => [],
			readResource: async () => [],
			getServerNames: () => ["known"],
		});

			const result = await readMcpResourceTool.call(
				{
					server: "unknown",
					uri: "file:///x",
				},
				createContext("/tmp/mcp-global"),
			);
			expect(result.data).toContain("not found");
			expect(result.data).toContain("known");
		});

		test("context-bound MCP provider works without global provider", async () => {
			const scopedContext = createContext("/tmp/mcp-scoped");
			bindMcpResourceProvider(scopedContext, {
				listResources: async () => [
					{
						uri: "file:///scoped/readme.md",
						name: "README",
						server: "scoped",
						description: "Scoped provider",
						mimeType: "text/markdown",
					},
				],
				readResource: async () => [
					{ type: "text" as const, text: "Scoped MCP resource" },
				],
				getServerNames: () => ["scoped"],
			});

			try {
				const listed = await listMcpResourcesTool.call({}, scopedContext);
				const read = await readMcpResourceTool.call(
					{
						server: "scoped",
						uri: "file:///scoped/readme.md",
					},
					scopedContext,
				);
				expect(listed.data).toContain("README");
				expect(read.data).toContain("Scoped MCP resource");
			} finally {
				unbindMcpResourceProvider(scopedContext);
			}
		});
	});

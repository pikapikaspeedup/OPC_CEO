/**
 * Task 管理工具 — 会话级任务追踪
 * 简化自 claude-code TaskCreateTool/TaskUpdateTool/TaskListTool/TaskGetTool
 * 使用内存存储，适合单会话 agent 使用
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

// ── Task store ─────────────────────────────────────────────────────

export type TaskStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "cancelled";

export type TaskItem = {
	id: string;
	subject: string;
	description: string;
	status: TaskStatus;
	activeForm?: string;
	metadata?: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
};

let nextId = 1;
const tasks = new Map<string, TaskItem>();

export function clearTasks(): void {
	tasks.clear();
	nextId = 1;
}

export function getTaskStore(): ReadonlyMap<string, TaskItem> {
	return tasks;
}

// ── TaskCreateTool ─────────────────────────────────────────────────

const createSchema = z.object({
	subject: z.string().describe("A brief title for the task"),
	description: z.string().describe("What needs to be done"),
	activeForm: z
		.string()
		.optional()
		.describe(
			'Present continuous form shown in spinner (e.g., "Running tests")',
		),
	metadata: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Arbitrary metadata"),
});

type CreateInput = z.infer<typeof createSchema>;

export const taskCreateTool = {
	name: "TaskCreateTool",
	aliases: ["task_create", "create_task"],
	inputSchema: createSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			subject: { type: "string", description: "A brief title for the task" },
			description: { type: "string", description: "What needs to be done" },
			activeForm: { type: "string", description: "Present continuous form" },
			metadata: { type: "object", description: "Arbitrary metadata" },
		},
		required: ["subject", "description"],
	},
	description: (input: CreateInput) =>
		`Create task: ${input.subject}`,

	async call(args: CreateInput): Promise<ToolResult<string>> {
		const id = `task-${nextId++}`;
		const now = Date.now();

		const task: TaskItem = {
			id,
			subject: args.subject,
			description: args.description,
			status: "pending",
			activeForm: args.activeForm,
			metadata: args.metadata,
			createdAt: now,
			updatedAt: now,
		};

		tasks.set(id, task);

		return {
			data: JSON.stringify({
				id,
				subject: task.subject,
				status: task.status,
			}),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 5_000,
	isDestructive: () => false,
} satisfies Tool<CreateInput, string>;

// ── TaskUpdateTool ─────────────────────────────────────────────────

const updateSchema = z.object({
	id: z.string().describe("Task ID to update"),
	status: z
		.enum(["pending", "in_progress", "completed", "failed", "cancelled"])
		.optional()
		.describe("New status"),
	subject: z.string().optional().describe("New subject"),
	description: z.string().optional().describe("New description"),
	activeForm: z.string().optional().describe("Updated active form"),
	metadata: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Metadata to merge"),
});

type UpdateInput = z.infer<typeof updateSchema>;

export const taskUpdateTool = {
	name: "TaskUpdateTool",
	aliases: ["task_update", "update_task"],
	inputSchema: updateSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Task ID to update" },
			status: {
				type: "string",
				enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
			},
			subject: { type: "string" },
			description: { type: "string" },
			activeForm: { type: "string" },
			metadata: { type: "object" },
		},
		required: ["id"],
	},
	description: (input: UpdateInput) => `Update task ${input.id}`,

	async call(args: UpdateInput): Promise<ToolResult<string>> {
		const task = tasks.get(args.id);
		if (!task) {
			throw new Error(`Task not found: ${args.id}`);
		}

		if (args.status) task.status = args.status;
		if (args.subject) task.subject = args.subject;
		if (args.description) task.description = args.description;
		if (args.activeForm !== undefined) task.activeForm = args.activeForm;
		if (args.metadata) {
			task.metadata = { ...task.metadata, ...args.metadata };
		}

		task.updatedAt = Date.now();

		if (
			args.status === "completed" ||
			args.status === "failed" ||
			args.status === "cancelled"
		) {
			task.completedAt = task.updatedAt;
		}

		return {
			data: JSON.stringify({
				id: task.id,
				subject: task.subject,
				status: task.status,
			}),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 5_000,
	isDestructive: () => false,
} satisfies Tool<UpdateInput, string>;

// ── TaskListTool ───────────────────────────────────────────────────

const listSchema = z.object({
	status: z
		.enum(["pending", "in_progress", "completed", "failed", "cancelled"])
		.optional()
		.describe("Filter by status"),
});

type ListInput = z.infer<typeof listSchema>;

export const taskListTool = {
	name: "TaskListTool",
	aliases: ["task_list", "list_tasks"],
	inputSchema: listSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			status: {
				type: "string",
				enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
			},
		},
	},
	description: () => "List all tasks",

	async call(args: ListInput): Promise<ToolResult<string>> {
		let items = Array.from(tasks.values());

		if (args.status) {
			items = items.filter((t) => t.status === args.status);
		}

		// Sort: in_progress first, then pending, then rest
		const statusOrder: Record<TaskStatus, number> = {
			in_progress: 0,
			pending: 1,
			completed: 2,
			failed: 3,
			cancelled: 4,
		};
		items.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

		if (items.length === 0) {
			return { data: "No tasks found." };
		}

		const statusIcon: Record<TaskStatus, string> = {
			pending: "[ ]",
			in_progress: "[>]",
			completed: "[x]",
			failed: "[!]",
			cancelled: "[-]",
		};

		const lines = items.map(
			(t) => `${statusIcon[t.status]} ${t.id}: ${t.subject} (${t.status})`,
		);

		return {
			data: `Tasks (${items.length}):\n${lines.join("\n")}`,
		};
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 10_000,
	isSearchOrReadCommand: () => ({ isSearch: false, isRead: true, isList: true }),
	isDestructive: () => false,
} satisfies Tool<ListInput, string>;

// ── TaskGetTool ────────────────────────────────────────────────────

const getSchema = z.object({
	id: z.string().describe("Task ID to retrieve"),
});

type GetInput = z.infer<typeof getSchema>;

export const taskGetTool = {
	name: "TaskGetTool",
	aliases: ["task_get", "get_task"],
	inputSchema: getSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Task ID to retrieve" },
		},
		required: ["id"],
	},
	description: (input: GetInput) => `Get task ${input.id}`,

	async call(args: GetInput): Promise<ToolResult<string>> {
		const task = tasks.get(args.id);
		if (!task) {
			throw new Error(`Task not found: ${args.id}`);
		}

		return {
			data: JSON.stringify(task, null, 2),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 5_000,
	isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
	isDestructive: () => false,
} satisfies Tool<GetInput, string>;

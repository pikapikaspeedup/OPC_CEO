/**
 * TodoWriteTool — 待办事项管理
 * 简化自 claude-code TodoWriteTool（去除 feature flag、GrowthBook、verification agent）
 */

import { z } from "zod";

import type { Tool, ToolResult } from "../types";

const todoItemSchema = z.object({
	id: z.string().describe("Unique identifier for the todo"),
	title: z.string().max(100).describe("Short action-oriented label (3-7 words)"),
	status: z
		.enum(["not-started", "in-progress", "completed"])
		.describe("Current status"),
});

const inputSchema = z.object({
	todos: z
		.array(todoItemSchema)
		.min(0)
		.max(50)
		.describe("Complete array of all todo items"),
});

type Input = z.infer<typeof inputSchema>;

export type TodoItem = z.infer<typeof todoItemSchema>;

// ── In-memory store (session-scoped) ───────────────────────────────
const todoStore = new Map<string, TodoItem[]>();

export function getTodos(sessionKey?: string): TodoItem[] {
	return todoStore.get(sessionKey ?? "default") ?? [];
}

export function clearTodos(sessionKey?: string): void {
	todoStore.delete(sessionKey ?? "default");
}

export const todoWriteTool = {
	name: "TodoWriteTool",
	aliases: ["todo_write", "update_todos"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			todos: {
				type: "array",
				description: "Complete array of all todo items",
				items: {
					type: "object",
					properties: {
						id: { type: "string", description: "Unique ID" },
						title: { type: "string", description: "Short label" },
						status: {
							type: "string",
							enum: ["not-started", "in-progress", "completed"],
						},
					},
					required: ["id", "title", "status"],
				},
			},
		},
		required: ["todos"],
	},
	description: () => "Create or update the todo list",

	async call(args: Input): Promise<ToolResult<string>> {
		const sessionKey = "default";
		const oldTodos = todoStore.get(sessionKey) ?? [];
		todoStore.set(sessionKey, args.todos);

		// Compute diff summary
		const added = args.todos.filter(
			(t) => !oldTodos.some((o) => o.id === t.id),
		).length;
		const removed = oldTodos.filter(
			(o) => !args.todos.some((t) => t.id === o.id),
		).length;
		const completed = args.todos.filter((t) => t.status === "completed").length;
		const inProgress = args.todos.filter((t) => t.status === "in-progress").length;

		return {
			data: JSON.stringify({
				total: args.todos.length,
				completed,
				inProgress,
				added,
				removed,
			}),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 5_000,
	isDestructive: () => false,
} satisfies Tool<Input, string>;

/**
 * AgentTool — 子 Agent 调度
 * 适配器模式：call() 发出 spawn 请求，实际执行由外部 runtime 完成
 * 简化自 claude-code AgentTool（去除 worktree/sandbox/多 model 依赖）
 */

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	prompt: z
		.string()
		.min(10)
		.describe("Detailed instruction for the sub-agent"),
	agentType: z
		.string()
		.optional()
		.describe(
			'Type of agent to spawn (e.g., "explorer", "coder", "reviewer")',
		),
	workingDirectory: z
		.string()
		.optional()
		.describe("Working directory for the sub-agent"),
	timeout: z
		.number()
		.optional()
		.describe("Timeout in seconds (default: 300)"),
});

type Input = z.infer<typeof inputSchema>;

export type AgentSpawnRequest = {
	prompt: string;
	agentType: string;
	workingDirectory: string;
	timeout: number;
	parentToolUseId?: string;
};

/**
 * Agent spawn handler — 由外部 runtime 注册
 * 如果未注册，tool 会用 context.exec 模拟执行
 */
export type AgentSpawnHandler = (
	request: AgentSpawnRequest,
	signal: AbortSignal,
) => Promise<string>;

let agentHandler: AgentSpawnHandler | null = null;
const scopedAgentHandlers = new WeakMap<ToolContext, AgentSpawnHandler>();

export function setAgentHandler(handler: AgentSpawnHandler): void {
	agentHandler = handler;
}

export function clearAgentHandler(): void {
	agentHandler = null;
}

export function bindAgentHandler(
	context: ToolContext,
	handler: AgentSpawnHandler,
): void {
	scopedAgentHandlers.set(context, handler);
}

export function unbindAgentHandler(context: ToolContext): void {
	scopedAgentHandlers.delete(context);
}

function getAgentHandler(context: ToolContext): AgentSpawnHandler | null {
	return scopedAgentHandlers.get(context) ?? agentHandler;
}

export const agentTool = {
	name: "AgentTool",
	aliases: ["agent", "spawn_agent", "sub_agent"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description: "Detailed instruction for the sub-agent",
			},
			agentType: {
				type: "string",
				description: "Type of agent to spawn",
			},
			workingDirectory: {
				type: "string",
				description: "Working directory for the sub-agent",
			},
			timeout: {
				type: "number",
				description: "Timeout in seconds (default: 300)",
			},
		},
		required: ["prompt"],
	},
	description: (input: Input) => {
		const type = input.agentType ?? "general";
		const promptPreview =
			input.prompt.length > 80
				? `${input.prompt.slice(0, 80)}...`
				: input.prompt;
		return `Spawn ${type} agent: ${promptPreview}`;
	},

		async call(
			args: Input,
			context: ToolContext,
		): Promise<ToolResult<string>> {
			const request: AgentSpawnRequest = {
			prompt: args.prompt,
			agentType: args.agentType ?? "general",
			workingDirectory: args.workingDirectory ?? context.workspacePath,
				timeout: args.timeout ?? 300,
			};

			const handler = getAgentHandler(context);
			if (handler) {
				const result = await handler(request, context.abortSignal);
				return { data: result };
			}

		// Fallback: no handler registered — return structured request
		return {
			data: JSON.stringify({
				status: "no_handler",
				message:
					"No agent handler registered. Use setAgentHandler() to enable sub-agent dispatch.",
				request,
			}),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 50_000,
	isDestructive: () => false,
} satisfies Tool<Input, string>;

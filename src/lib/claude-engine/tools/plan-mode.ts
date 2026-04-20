/**
 * PlanModeTool — 规划模式进入/退出/验证
 * 简化自 claude-code EnterPlanModeTool + ExitPlanModeV2Tool + VerifyPlanExecutionTool
 * 去除权限状态机、team/mailbox、feature flags，保留核心规划文件管理
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

// ── Plan state (session-scoped) ────────────────────────────────────

let planMode = false;
let planContent = "";
let planCreatedAt: number | null = null;

export function isPlanMode(): boolean {
	return planMode;
}

export function getPlanContent(): string {
	return planContent;
}

export function clearPlanState(): void {
	planMode = false;
	planContent = "";
	planCreatedAt = null;
}

// ── EnterPlanModeTool ──────────────────────────────────────────────

const enterSchema = z.object({});

export const enterPlanModeTool = {
	name: "EnterPlanModeTool",
	aliases: ["enter_plan_mode", "plan"],
	inputSchema: enterSchema,
	inputJSONSchema: {
		type: "object",
		properties: {},
	},
	description: () => "Enter plan mode — tool calls are blocked until plan is approved",

	async call(): Promise<ToolResult<string>> {
		if (planMode) {
			return { data: "Already in plan mode." };
		}
		planMode = true;
		planCreatedAt = Date.now();
		planContent = "";
		return {
			data: "Entered plan mode. Create your plan, then exit plan mode to execute.",
		};
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 2_000,
	isDestructive: () => false,
} satisfies Tool<z.infer<typeof enterSchema>, string>;

// ── ExitPlanModeTool ───────────────────────────────────────────────

const exitSchema = z.object({
	plan: z
		.string()
		.optional()
		.describe("The finalized plan content (markdown). If omitted, uses accumulated plan."),
});

export const exitPlanModeTool = {
	name: "ExitPlanModeTool",
	aliases: ["exit_plan_mode", "approve_plan"],
	inputSchema: exitSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			plan: {
				type: "string",
				description: "The finalized plan content (markdown)",
			},
		},
	},
	description: () => "Exit plan mode and save the plan",

	async call(
		args: z.infer<typeof exitSchema>,
		context: ToolContext,
	): Promise<ToolResult<string>> {
		if (!planMode) {
			return { data: "Not in plan mode." };
		}

		const finalPlan = args.plan ?? planContent;
		planMode = false;

		if (!finalPlan.trim()) {
			planContent = "";
			return { data: "Exited plan mode. No plan was saved (empty)." };
		}

		// Save plan to workspace
		const planDir = path.join(context.workspacePath, ".claude", "plans");
		await fs.mkdir(planDir, { recursive: true });

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const planFile = path.join(planDir, `plan-${timestamp}.md`);
		await fs.writeFile(planFile, finalPlan, "utf8");

		planContent = finalPlan;
		const duration = planCreatedAt
			? Math.round((Date.now() - planCreatedAt) / 1000)
			: 0;
		planCreatedAt = null;

		return {
			data: `Exited plan mode. Plan saved to ${planFile} (${finalPlan.split("\n").length} lines, ${duration}s in plan mode).`,
		};
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 5_000,
	isDestructive: () => false,
} satisfies Tool<z.infer<typeof exitSchema>, string>;

// ── VerifyPlanExecutionTool ────────────────────────────────────────

const verifySchema = z.object({
	planSummary: z
		.string()
		.optional()
		.describe("Brief summary of the plan that was executed"),
	completedSteps: z
		.array(z.string())
		.optional()
		.describe("List of completed plan steps"),
	remainingSteps: z
		.array(z.string())
		.optional()
		.describe("List of remaining plan steps"),
});

export const verifyPlanExecutionTool = {
	name: "VerifyPlanExecutionTool",
	aliases: ["verify_plan", "check_plan"],
	inputSchema: verifySchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			planSummary: { type: "string", description: "Brief summary of the plan" },
			completedSteps: {
				type: "array",
				items: { type: "string" },
				description: "Completed steps",
			},
			remainingSteps: {
				type: "array",
				items: { type: "string" },
				description: "Remaining steps",
			},
		},
	},
	description: () => "Verify execution progress against the plan",

	async call(args: z.infer<typeof verifySchema>): Promise<ToolResult<string>> {
		const completed = args.completedSteps ?? [];
		const remaining = args.remainingSteps ?? [];
		const total = completed.length + remaining.length;

		const lines: string[] = [];

		if (args.planSummary) {
			lines.push(`## Plan: ${args.planSummary}`, "");
		}

		if (total === 0) {
			lines.push("No steps specified. Use completedSteps and remainingSteps to track progress.");
		} else {
			const pct = Math.round((completed.length / total) * 100);
			lines.push(`Progress: ${completed.length}/${total} (${pct}%)`, "");

			if (completed.length > 0) {
				lines.push("### Completed");
				for (const s of completed) lines.push(`- [x] ${s}`);
				lines.push("");
			}

			if (remaining.length > 0) {
				lines.push("### Remaining");
				for (const s of remaining) lines.push(`- [ ] ${s}`);
			}
		}

		return { data: lines.join("\n") };
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 10_000,
	isDestructive: () => false,
} satisfies Tool<z.infer<typeof verifySchema>, string>;

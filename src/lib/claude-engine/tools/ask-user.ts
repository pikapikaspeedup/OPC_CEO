/**
 * AskUserQuestionTool — 向用户提问
 * 纯透传设计：call() 返回问题数据，UI 层负责渲染和收集回答
 */

import { z } from "zod";

import type { Tool, ToolResult } from "../types";

const optionSchema = z.object({
	label: z
		.string()
		.max(80)
		.describe("Display text for the option (1-5 words)"),
	description: z
		.string()
		.optional()
		.describe("Explanation of what this option means"),
});

const questionSchema = z.object({
	question: z.string().describe("The question to ask"),
	header: z.string().max(30).describe("Short label for the question"),
	options: z
		.array(optionSchema)
		.min(2)
		.max(6)
		.optional()
		.describe("Selectable options"),
	multiSelect: z
		.boolean()
		.optional()
		.describe("Allow selecting multiple options"),
});

const inputSchema = z.object({
	questions: z
		.array(questionSchema)
		.min(1)
		.max(4)
		.describe("Questions to ask the user"),
	answers: z
		.record(z.string(), z.string())
		.optional()
		.describe("Pre-filled answers (header → answer text)"),
});

type Input = z.infer<typeof inputSchema>;

export type AskUserOutput = {
	questions: Input["questions"];
	answers: Record<string, string>;
	needsUserInput: boolean;
};

export const askUserQuestionTool = {
	name: "AskUserQuestionTool",
	aliases: ["ask_user", "ask_question"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			questions: {
				type: "array",
				description: "Questions to ask the user",
				items: {
					type: "object",
					properties: {
						question: { type: "string" },
						header: { type: "string" },
						options: {
							type: "array",
							items: {
								type: "object",
								properties: {
									label: { type: "string" },
									description: { type: "string" },
								},
								required: ["label"],
							},
						},
						multiSelect: { type: "boolean" },
					},
					required: ["question", "header"],
				},
			},
			answers: {
				type: "object",
				description: "Pre-filled answers (header → answer text)",
			},
		},
		required: ["questions"],
	},
	description: () => "Ask the user a question or present options for selection",

	async call(args: Input): Promise<ToolResult<string>> {
		const answers = args.answers ?? {};

		// Check which questions still need answers
		const unanswered = args.questions.filter(
			(q) => !(q.header in answers),
		);

		const output: AskUserOutput = {
			questions: args.questions,
			answers,
			needsUserInput: unanswered.length > 0,
		};

		return {
			data: JSON.stringify(output),
		};
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 5_000,
	isDestructive: () => false,
} satisfies Tool<Input, string>;

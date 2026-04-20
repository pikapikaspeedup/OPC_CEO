/**
 * SkillTool — 技能文件查找与应用
 * 简化自 claude-code SkillTool（去除 CLAUDE.md 集成、UI overlay）
 * 在指定目录中搜索 SKILL.md，返回内容供 agent 使用
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	skillName: z.string().describe("Name or keyword of the skill to look up"),
	skillDirs: z
		.array(z.string())
		.optional()
		.describe(
			"Directories to search for skills (defaults to .claude/skills and .agents/skills)",
		),
});

type Input = z.infer<typeof inputSchema>;

export type SkillInfo = {
	name: string;
	path: string;
	description: string;
	content: string;
};

async function findSkills(
	baseDirs: string[],
	query: string,
): Promise<SkillInfo[]> {
	const results: SkillInfo[] = [];
	const queryLower = query.toLowerCase();

	for (const baseDir of baseDirs) {
		try {
			const entries = await fs.readdir(baseDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				// Check if directory name matches query
				if (!entry.name.toLowerCase().includes(queryLower)) continue;

				const skillFile = path.join(baseDir, entry.name, "SKILL.md");
				try {
					const content = await fs.readFile(skillFile, "utf8");

					// Extract first heading or first line as description
					const firstLine = content
						.split("\n")
						.find((l) => l.trim().length > 0);
					const description = firstLine
						? firstLine.replace(/^#+\s*/, "").trim()
						: entry.name;

					results.push({
						name: entry.name,
						path: skillFile,
						description,
						content,
					});
				} catch {
					// No SKILL.md in this directory — skip
				}
			}
		} catch {
			// Directory doesn't exist — skip
		}
	}

	return results;
}

export const skillTool = {
	name: "SkillTool",
	aliases: ["skill", "lookup_skill"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			skillName: {
				type: "string",
				description: "Name or keyword of the skill to look up",
			},
			skillDirs: {
				type: "array",
				items: { type: "string" },
				description: "Directories to search for skills",
			},
		},
		required: ["skillName"],
	},
	description: (input: Input) =>
		`Look up skill: ${input.skillName}`,

	async call(
		args: Input,
		context: ToolContext,
	): Promise<ToolResult<string>> {
		const defaultDirs = [
			path.join(context.workspacePath, ".claude", "skills"),
			path.join(context.workspacePath, ".agents", "skills"),
		];

		// Include home directory skills
		const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
		if (homeDir) {
			defaultDirs.push(path.join(homeDir, ".claude", "skills"));
			defaultDirs.push(path.join(homeDir, ".agents", "skills"));
		}

		const searchDirs = args.skillDirs?.length ? args.skillDirs : defaultDirs;

		const skills = await findSkills(searchDirs, args.skillName);

		if (skills.length === 0) {
			return {
				data: `No skills found matching "${args.skillName}" in:\n${searchDirs.join("\n")}`,
			};
		}

		if (skills.length === 1) {
			const s = skills[0];
			return {
				data: `# Skill: ${s.name}\n\nSource: ${s.path}\n\n${s.content}`,
			};
		}

		// Multiple matches — show list
		const lines = [
			`Found ${skills.length} skills matching "${args.skillName}":`,
			"",
		];
		for (const s of skills) {
			lines.push(`- **${s.name}**: ${s.description}`);
			lines.push(`  Path: ${s.path}`);
		}

		return { data: lines.join("\n") };
	},

	isEnabled: () => true,
	isReadOnly: () => true,
	isConcurrencySafe: () => true,
	maxResultSizeChars: 20_000,
	isSearchOrReadCommand: () => ({ isSearch: true, isRead: true }),
	isDestructive: () => false,
} satisfies Tool<Input, string>;

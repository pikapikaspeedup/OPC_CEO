/**
 * ConfigTool — 运行时配置管理
 * 简化自 claude-code ConfigTool（去除 voice mode、网络验证、AppState 同步）
 * 提供运行时配置的读取和修改
 */

import { z } from "zod";

import type { Tool, ToolResult } from "../types";

const inputSchema = z.object({
	action: z
		.enum(["get", "set", "list", "reset"])
		.describe("Config operation"),
	key: z
		.string()
		.optional()
		.describe("Config key (required for get/set/reset)"),
	value: z
		.unknown()
		.optional()
		.describe("Config value (required for set)"),
});

type Input = z.infer<typeof inputSchema>;

// ── Config store ───────────────────────────────────────────────────

export type ConfigSchema = {
	key: string;
	description: string;
	type: "string" | "number" | "boolean";
	defaultValue: unknown;
	validate?: (value: unknown) => boolean;
};

const schemas: ConfigSchema[] = [
	{ key: "model", description: "Default model to use", type: "string", defaultValue: "claude-sonnet-4-20250514" },
	{ key: "maxTokens", description: "Maximum output tokens", type: "number", defaultValue: 16384 },
	{ key: "temperature", description: "Sampling temperature (0-1)", type: "number", defaultValue: 1, validate: (v) => typeof v === "number" && v >= 0 && v <= 2 },
	{ key: "topK", description: "Top-K sampling parameter", type: "number", defaultValue: 0 },
	{ key: "maxTurns", description: "Maximum conversation turns", type: "number", defaultValue: 100, validate: (v) => typeof v === "number" && v > 0 && v <= 1000 },
	{ key: "verbose", description: "Enable verbose logging", type: "boolean", defaultValue: false },
	{ key: "compactThreshold", description: "Token threshold for auto-compaction (%)", type: "number", defaultValue: 85, validate: (v) => typeof v === "number" && v > 0 && v <= 100 },
	{ key: "maxContinuations", description: "Max continuation retries on truncation", type: "number", defaultValue: 3, validate: (v) => typeof v === "number" && v >= 0 && v <= 10 },
];

const configStore = new Map<string, unknown>();

// Initialize defaults
for (const s of schemas) {
	configStore.set(s.key, s.defaultValue);
}

export function getConfigValue(key: string): unknown {
	return configStore.get(key);
}

export function setConfigValue(key: string, value: unknown): void {
	configStore.set(key, value);
}

export function resetConfig(): void {
	configStore.clear();
	for (const s of schemas) {
		configStore.set(s.key, s.defaultValue);
	}
}

export function getConfigSchemas(): readonly ConfigSchema[] {
	return schemas;
}

export const configTool = {
	name: "ConfigTool",
	aliases: ["config", "settings"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			action: {
				type: "string",
				enum: ["get", "set", "list", "reset"],
				description: "Config operation",
			},
			key: { type: "string", description: "Config key" },
			value: { description: "Config value" },
		},
		required: ["action"],
	},
	description: (input: Input) => {
		switch (input.action) {
			case "get": return `Get config: ${input.key}`;
			case "set": return `Set config: ${input.key}`;
			case "list": return "List all config settings";
			case "reset": return input.key ? `Reset config: ${input.key}` : "Reset all config";
		}
	},

	async call(args: Input): Promise<ToolResult<string>> {
		switch (args.action) {
			case "list": {
				const lines = ["Configuration settings:", ""];
				for (const s of schemas) {
					const current = configStore.get(s.key);
					const isDefault = JSON.stringify(current) === JSON.stringify(s.defaultValue);
					lines.push(
						`- **${s.key}** (${s.type}): ${JSON.stringify(current)}${isDefault ? " [default]" : ""}`
					);
					lines.push(`  ${s.description}`);
				}
				return { data: lines.join("\n") };
			}

			case "get": {
				if (!args.key) throw new Error("key is required for 'get'");
				const schema = schemas.find((s) => s.key === args.key);
				if (!schema) {
					return { data: `Unknown config key: ${args.key}. Use 'list' to see available keys.` };
				}
				const value = configStore.get(args.key);
				return {
					data: JSON.stringify({
						key: args.key,
						value,
						type: schema.type,
						description: schema.description,
						isDefault: JSON.stringify(value) === JSON.stringify(schema.defaultValue),
					}),
				};
			}

			case "set": {
				if (!args.key) throw new Error("key is required for 'set'");
				if (args.value === undefined) throw new Error("value is required for 'set'");
				const schema = schemas.find((s) => s.key === args.key);
				if (!schema) {
					return { data: `Unknown config key: ${args.key}. Use 'list' to see available keys.` };
				}
				if (schema.validate && !schema.validate(args.value)) {
					return { data: `Invalid value for ${args.key}: ${JSON.stringify(args.value)}` };
				}
				const old = configStore.get(args.key);
				configStore.set(args.key, args.value);
				return {
					data: JSON.stringify({
						key: args.key,
						oldValue: old,
						newValue: args.value,
					}),
				};
			}

			case "reset": {
				if (args.key) {
					const schema = schemas.find((s) => s.key === args.key);
					if (!schema) {
						return { data: `Unknown config key: ${args.key}` };
					}
					configStore.set(args.key, schema.defaultValue);
					return { data: `Reset ${args.key} to default: ${JSON.stringify(schema.defaultValue)}` };
				}
				resetConfig();
				return { data: "All config settings reset to defaults." };
			}

			default:
				throw new Error(`Unknown action: ${args.action}`);
		}
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 10_000,
	isDestructive: () => false,
} satisfies Tool<Input, string>;

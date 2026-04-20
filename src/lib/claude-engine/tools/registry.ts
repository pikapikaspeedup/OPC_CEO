import type { Tool, Tools } from "../types";

import { agentTool } from "./agent";
import { askUserQuestionTool } from "./ask-user";
import { bashTool } from "./bash";
import { configTool } from "./config";
import { fileEditTool } from "./file-edit";
import { fileReadTool } from "./file-read";
import { fileWriteTool } from "./file-write";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { listMcpResourcesTool, readMcpResourceTool } from "./mcp-resources";
import { notebookEditTool } from "./notebook-edit";
import { enterPlanModeTool, exitPlanModeTool, verifyPlanExecutionTool } from "./plan-mode";
import { skillTool } from "./skill";
import { skillManageTool } from "./skill-manage";
import { taskCreateTool, taskGetTool, taskListTool, taskUpdateTool } from "./task";
import { todoWriteTool } from "./todo-write";
import { toolSearchTool } from "./tool-search";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";
import { sessionSearchTool } from "./session-search";

export type GetToolsOptions = {
	enabledOnly?: boolean;
	readOnlyOnly?: boolean;
};


const CORE_TOOLS: Tool[] = [
	// File operations
	fileReadTool,
	fileWriteTool,
	fileEditTool,
	notebookEditTool,
	// Shell & search
	bashTool,
	globTool,
	grepTool,
	// Web
	webFetchTool,
	webSearchTool,
	// Task management
	taskCreateTool,
	taskUpdateTool,
	taskListTool,
	taskGetTool,
	todoWriteTool,
	// User interaction
	askUserQuestionTool,
	agentTool,
	skillTool,
	skillManageTool,
	// Planning
	enterPlanModeTool,
	exitPlanModeTool,
	verifyPlanExecutionTool,
	// Discovery & config
	toolSearchTool,
	configTool,
	// MCP resources
	listMcpResourcesTool,
	readMcpResourceTool,
	// Session search
	sessionSearchTool,
];

export class ToolRegistry {
	private tools: Map<string, Tool> = new Map();
	private aliases: Map<string, string> = new Map();

	register(tool: Tool): void {
		const existingTool = this.tools.get(tool.name);

		if (existingTool) {
			this.removeAliases(existingTool);
		}

		this.tools.set(tool.name, tool);

		for (const alias of tool.aliases ?? []) {
			this.aliases.set(alias, tool.name);
		}
	}

	unregister(name: string): boolean {
		const tool = this.get(name);

		if (!tool) {
			return false;
		}

		this.tools.delete(tool.name);
		this.removeAliases(tool);
		return true;
	}

	get(name: string): Tool | undefined {
		if (this.tools.has(name)) {
			return this.tools.get(name);
		}

		const canonicalName = this.aliases.get(name);

		if (!canonicalName) {
			return undefined;
		}

		return this.tools.get(canonicalName);
	}

	getAll(): Tools {
		return Array.from(this.tools.values());
	}

	getEnabled(): Tools {
		return this.getAll().filter((tool) => tool.isEnabled());
	}

	/**
	 * Returns tools that are always read-only (statically determined).
	 * Tools whose read-only status depends on input (like BashTool) are excluded.
	 */
	getReadOnly(): Tools {
		return this.getAll().filter((tool) => {
			try {
				// Tools that are unconditionally readOnly return true for any input.
				// Input-dependent tools (like BashTool) may throw or return false.
				return tool.isReadOnly({} as Record<string, unknown>);
			} catch {
				return false;
			}
		});
	}

	has(name: string): boolean {
		return this.get(name) !== undefined;
	}

	clear(): void {
		this.tools.clear();
		this.aliases.clear();
	}

	get size(): number {
		return this.tools.size;
	}

	private removeAliases(tool: Tool): void {
		for (const alias of tool.aliases ?? []) {
			if (this.aliases.get(alias) === tool.name) {
				this.aliases.delete(alias);
			}
		}
	}
}

let defaultRegistry: ToolRegistry | null = null;

export function createDefaultRegistry(): ToolRegistry {
	const registry = new ToolRegistry();

	for (const tool of CORE_TOOLS) {
		registry.register(tool);
	}

	return registry;
}

function getDefaultRegistry(): ToolRegistry {
	defaultRegistry ??= createDefaultRegistry();
	return defaultRegistry;
}

export function registerTool(tool: Tool): void {
	getDefaultRegistry().register(tool);
}

export function getTools(options: GetToolsOptions = {}): Tools {
	const registry = getDefaultRegistry();
	let tools = registry.getAll();

	if (options.enabledOnly) {
		tools = tools.filter((tool) => tool.isEnabled());
	}

	if (options.readOnlyOnly) {
		tools = tools.filter((tool) => {
			try {
				return tool.isReadOnly({} as Record<string, unknown>);
			} catch {
				return false;
			}
		});
	}

	return tools;
}

export function findTool(name: string): Tool | undefined {
	return getDefaultRegistry().get(name);
}

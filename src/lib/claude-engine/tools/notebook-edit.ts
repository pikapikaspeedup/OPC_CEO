/**
 * NotebookEditTool — Jupyter Notebook 单元格编辑
 * 简化自 claude-code NotebookEditTool（去除权限系统、文件历史、AppState 依赖）
 * 支持 .ipynb 文件的单元格内容替换、插入和删除
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Tool, ToolContext, ToolResult } from "../types";

const inputSchema = z.object({
	notebook_path: z.string().describe("Path to the .ipynb notebook file"),
	command: z
		.enum(["edit", "insert", "delete"])
		.describe("Operation to perform on the cell"),
	cell_id: z
		.string()
		.optional()
		.describe("Cell ID to edit/delete (required for edit/delete)"),
	cell_index: z
		.number()
		.optional()
		.describe("Index to insert a new cell at (required for insert)"),
	new_source: z
		.string()
		.optional()
		.describe("New source content for the cell (required for edit/insert)"),
	cell_type: z
		.enum(["code", "markdown", "raw"])
		.optional()
		.describe("Cell type for insert (default: code)"),
});

type Input = z.infer<typeof inputSchema>;

type NotebookCell = {
	id?: string;
	cell_type: string;
	source: string[];
	metadata: Record<string, unknown>;
	outputs?: unknown[];
	execution_count?: number | null;
};

type Notebook = {
	nbformat: number;
	nbformat_minor: number;
	metadata: Record<string, unknown>;
	cells: NotebookCell[];
};

function generateCellId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export const notebookEditTool = {
	name: "NotebookEditTool",
	aliases: ["notebook_edit", "edit_notebook"],
	inputSchema,
	inputJSONSchema: {
		type: "object",
		properties: {
			notebook_path: { type: "string", description: "Path to .ipynb file" },
			command: {
				type: "string",
				enum: ["edit", "insert", "delete"],
				description: "Operation to perform",
			},
			cell_id: { type: "string", description: "Cell ID (for edit/delete)" },
			cell_index: { type: "number", description: "Insert position index" },
			new_source: { type: "string", description: "New cell content" },
			cell_type: {
				type: "string",
				enum: ["code", "markdown", "raw"],
				description: "Cell type for insert",
			},
		},
		required: ["notebook_path", "command"],
	},
	description: (input: Input) =>
		`${input.command} cell in notebook ${path.basename(input.notebook_path)}`,

	async call(
		args: Input,
		context: ToolContext,
	): Promise<ToolResult<string>> {
		const absPath = path.isAbsolute(args.notebook_path)
			? args.notebook_path
			: path.resolve(context.workspacePath, args.notebook_path);

		// Validate path is within workspace
		if (!absPath.startsWith(context.workspacePath)) {
			throw new Error("Path traversal denied: notebook must be within workspace");
		}

		// Read notebook
		let raw: string;
		try {
			raw = await fs.readFile(absPath, "utf8");
		} catch {
			throw new Error(`Notebook not found: ${absPath}`);
		}

		let notebook: Notebook;
		try {
			notebook = JSON.parse(raw) as Notebook;
		} catch {
			throw new Error(`Invalid notebook JSON: ${absPath}`);
		}

		if (!Array.isArray(notebook.cells)) {
			throw new Error("Notebook has no cells array");
		}

		switch (args.command) {
			case "edit": {
				if (!args.cell_id) throw new Error("cell_id is required for edit");
				if (args.new_source === undefined) throw new Error("new_source is required for edit");

				const idx = notebook.cells.findIndex((c) => c.id === args.cell_id);
				if (idx === -1) throw new Error(`Cell not found: ${args.cell_id}`);

				notebook.cells[idx].source = args.new_source.split("\n").map((line, i, arr) =>
					i < arr.length - 1 ? `${line}\n` : line,
				);
				// Clear outputs for code cells
				if (notebook.cells[idx].cell_type === "code") {
					notebook.cells[idx].outputs = [];
					notebook.cells[idx].execution_count = null;
				}

				await fs.writeFile(absPath, JSON.stringify(notebook, null, 1), "utf8");
				return { data: `Edited cell ${args.cell_id} in ${path.basename(absPath)}` };
			}

			case "insert": {
				if (args.new_source === undefined) throw new Error("new_source is required for insert");
				const insertIdx = args.cell_index ?? notebook.cells.length;

				const newCell: NotebookCell = {
					id: generateCellId(),
					cell_type: args.cell_type ?? "code",
					source: args.new_source.split("\n").map((line, i, arr) =>
						i < arr.length - 1 ? `${line}\n` : line,
					),
					metadata: {},
				};

				if (newCell.cell_type === "code") {
					newCell.outputs = [];
					newCell.execution_count = null;
				}

				notebook.cells.splice(insertIdx, 0, newCell);

				await fs.writeFile(absPath, JSON.stringify(notebook, null, 1), "utf8");
				return {
					data: `Inserted ${newCell.cell_type} cell (id: ${newCell.id}) at index ${insertIdx} in ${path.basename(absPath)}`,
				};
			}

			case "delete": {
				if (!args.cell_id) throw new Error("cell_id is required for delete");

				const delIdx = notebook.cells.findIndex((c) => c.id === args.cell_id);
				if (delIdx === -1) throw new Error(`Cell not found: ${args.cell_id}`);

				notebook.cells.splice(delIdx, 1);

				await fs.writeFile(absPath, JSON.stringify(notebook, null, 1), "utf8");
				return { data: `Deleted cell ${args.cell_id} from ${path.basename(absPath)}` };
			}

			default:
				throw new Error(`Unknown command: ${args.command}`);
		}
	},

	isEnabled: () => true,
	isReadOnly: () => false,
	isConcurrencySafe: () => false,
	maxResultSizeChars: 10_000,
	isDestructive: () => false,
} satisfies Tool<Input, string>;

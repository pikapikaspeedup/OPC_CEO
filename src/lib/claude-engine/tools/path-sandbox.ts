import * as path from "node:path";

import type { ToolContext } from "../types";

/**
 * Resolves and sandboxes a file path, ensuring it stays within allowed directories.
 * Throws if the resolved path escapes the workspace and additional working directories.
 */
export function resolveSandboxedPath(
	filePath: string,
	context: ToolContext,
): string {
	return resolveSandboxedPathForAccess(filePath, context, "read");
}

export function resolveSandboxedReadPath(
	filePath: string,
	context: ToolContext,
): string {
	return resolveSandboxedPathForAccess(filePath, context, "read");
}

export function resolveSandboxedWritePath(
	filePath: string,
	context: ToolContext,
): string {
	return resolveSandboxedPathForAccess(filePath, context, "write");
}

function resolveSandboxedPathForAccess(
	filePath: string,
	context: ToolContext,
	access: "read" | "write",
): string {
	const resolved = path.isAbsolute(filePath)
		? path.resolve(filePath)
		: path.resolve(context.workspacePath, filePath);

	const normalizedResolved = ensureTrailingSlash(path.resolve(resolved));
	const allowedRoots = getAllowedRoots(context, access);

	for (const root of allowedRoots) {
		const normalizedRoot = ensureTrailingSlash(path.resolve(root));

		if (
			normalizedResolved.startsWith(normalizedRoot) ||
			normalizedResolved === normalizedRoot.slice(0, -1)
		) {
			return resolved;
		}
	}

	throw new Error(
		`Path traversal denied (${access}): ${filePath} resolves to ${resolved} which is outside allowed roots: ${allowedRoots.join(", ")}`,
	);
}

function getAllowedRoots(
	context: ToolContext,
	access: "read" | "write",
): string[] {
	const configuredRoots = access === "write"
		? context.writeRoots
		: context.readRoots;
	if (configuredRoots && configuredRoots.length > 0) {
		return configuredRoots;
	}

	return [
		context.workspacePath,
		...(context.additionalWorkingDirectories ?? []),
	];
}

function ensureTrailingSlash(p: string): string {
	return p.endsWith(path.sep) ? p : p + path.sep;
}

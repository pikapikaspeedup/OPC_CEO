/**
 * Adapter for @anthropic-claude/security-core
 * Bridges claude-code's complete bash security & permission engine into Antigravity's tool execution chain.
 * 
 * Phase 1: 23 security validators (injection, encoding, control chars, etc.)
 * Phase 2: Rule matching & dangerous command patterns
 * Phase 3: Full permission sub-validators (sed, path, mode, sandbox, AST)
 */
import {
	bashCommandIsSafe,
	configureAnalytics,
	configureSecurityContext,
	commandMatchesRule,
	isDangerousBashCommand,
	DANGEROUS_BASH_PATTERNS,
	checkSedConstraints,
	checkPathConstraints,
	checkPermissionMode,
	checkCommandOperatorPermissions,
	shouldUseSandbox,
	splitCommand_DEPRECATED,
	extractOutputRedirections,
	checkSemantics,
	parseCommandRaw,
	type PermissionResult,
} from "../security-core";

export type SecurityCheckResult = {
	allowed: boolean;
	reason: string;
	/** Original PermissionResult for detailed inspection */
	raw: PermissionResult;
};

/**
 * Initialize security-core with runtime context and optional analytics.
 * Call once at startup.
 */
export function initSecurityCore(options?: {
	cwd?: string;
	logger?: (event: string, data?: Record<string, unknown>) => void;
}): void {
	if (options?.cwd) {
		configureSecurityContext({ cwd: options.cwd });
	}
	if (options?.logger) {
		configureAnalytics(options.logger);
	}
}

/**
 * Check if a bash command is safe to execute.
 * Uses claude-code's full 23-validator security engine.
 *
 * Returns:
 * - allowed=true: command is safe (passthrough/allow)
 * - allowed=false: command is dangerous (ask/deny), with reason
 */
export function checkBashSecurity(command: string): SecurityCheckResult {
	const result = bashCommandIsSafe(command);

	if (result.behavior === "passthrough" || result.behavior === "allow") {
		return {
			allowed: true,
			reason: "message" in result ? (result.message ?? "Command passed security checks") : "Command passed security checks",
			raw: result,
		};
	}

	return {
		allowed: false,
		reason: "message" in result ? (result.message ?? "Command blocked by security check") : "Command blocked by security check",
		raw: result,
	};
}

/**
 * Check if a command matches a permission rule (exact, prefix, or wildcard).
 * Uses claude-code's shellRuleMatching engine.
 */
export function matchesPermissionRule(
	command: string,
	ruleContent: string,
): boolean {
	return commandMatchesRule(command, ruleContent);
}

/**
 * Check if a command is a dangerous code execution entry point.
 * Detects interpreters (python, node, ruby), package runners (npx, npm run),
 * and dangerous builtins (eval, exec, sudo).
 */
export function isDangerousCommand(command: string): boolean {
	return isDangerousBashCommand(command);
}

/**
 * Phase 3: Advanced command analysis - split compound commands.
 */
export function splitCompoundCommand(command: string) {
	return splitCommand_DEPRECATED(command);
}

/**
 * Phase 3: Extract output redirections from a command string.
 */
export function getOutputRedirections(command: string) {
	return extractOutputRedirections(command);
}

// Re-export for direct use
export {
	bashCommandIsSafe,
	configureAnalytics,
	configureSecurityContext,
	commandMatchesRule,
	isDangerousBashCommand,
	DANGEROUS_BASH_PATTERNS,
	checkSedConstraints,
	checkPathConstraints,
	checkPermissionMode,
	checkCommandOperatorPermissions,
	shouldUseSandbox,
	splitCommand_DEPRECATED,
	extractOutputRedirections,
	checkSemantics,
	parseCommandRaw,
} from "../security-core";

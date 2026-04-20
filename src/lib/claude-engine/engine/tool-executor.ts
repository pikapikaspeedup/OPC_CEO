import * as path from 'node:path';

import type { Tool, ToolContext, ToolResult } from '../types';
import type { PermissionChecker } from '../permissions/checker';
import type { PermissionMode } from '../types/permissions';
import type { DepartmentRequiredArtifact } from '../../organization/contracts';

import type { ToolCallResult, ToolUseBlock } from './types';
import { checkBashSecurity, isDangerousCommand, splitCompoundCommand } from '../security/bash-security-adapter';

type UnknownTool = Tool<Record<string, unknown>, unknown>;

export const DEPARTMENT_RUNTIME_CONTEXT = Symbol(
  'department-runtime-context',
);

export type ResolvedRequiredArtifact = DepartmentRequiredArtifact & {
  absolutePath: string;
};

export type DepartmentRuntimePolicy = {
  permissionMode: PermissionMode;
  permissionChecker: PermissionChecker;
  readRoots: string[];
  writeRoots: string[];
  additionalWorkingDirectories: string[];
  artifactRoot?: string;
  requiredArtifacts: ResolvedRequiredArtifact[];
  allowSubAgents: boolean;
};

type ToolContextWithDepartmentRuntime = ToolContext & {
  [DEPARTMENT_RUNTIME_CONTEXT]?: DepartmentRuntimePolicy;
};

export function attachDepartmentRuntimeContext(
  context: ToolContext,
  policy: DepartmentRuntimePolicy,
): ToolContext {
  (context as ToolContextWithDepartmentRuntime)[DEPARTMENT_RUNTIME_CONTEXT] =
    policy;
  return context;
}

export function getDepartmentRuntimeContext(
  context: ToolContext,
): DepartmentRuntimePolicy | undefined {
  return (context as ToolContextWithDepartmentRuntime)[
    DEPARTMENT_RUNTIME_CONTEXT
  ];
}

export class ToolExecutor {
  constructor(
    private tools: Map<string, Tool>,
    private context: ToolContext,
  ) {}

  async *executeTools(
    toolUseBlocks: ToolUseBlock[],
  ): AsyncGenerator<ToolCallResult> {
    const sequentialBlocks: ToolUseBlock[] = [];
    const parallelBlocks: ToolUseBlock[] = [];

    for (const block of toolUseBlocks) {
      if (this.canRunInParallel(block)) {
        parallelBlocks.push(block);
      } else {
        sequentialBlocks.push(block);
      }
    }

    for (const block of sequentialBlocks) {
      yield await this.executeSingleTool(block);
    }

    const parallelResults = await Promise.all(
      parallelBlocks.map((block) => this.executeSingleTool(block)),
    );

    for (const result of parallelResults) {
      yield result;
    }
  }

  private async executeSingleTool(block: ToolUseBlock): Promise<ToolCallResult> {
    const startedAt = Date.now();
    const tool = this.tools.get(block.name) as UnknownTool | undefined;

    if (!tool) {
      return this.buildErrorResult(
        block,
        `Unknown tool: ${block.name}`,
        startedAt,
      );
    }

    if (!tool.isEnabled()) {
      return this.buildErrorResult(
        block,
        `Tool is disabled: ${block.name}`,
        startedAt,
      );
    }

    const parsedInput = tool.inputSchema.safeParse(block.input);

    if (!parsedInput.success) {
      return this.buildErrorResult(
        block,
        parsedInput.error.message,
        startedAt,
      );
    }

    try {
      const runtimePolicy = getDepartmentRuntimeContext(this.context);
      if (runtimePolicy) {
        const permissionDecision = runtimePolicy.permissionChecker.check(
          block.name,
          parsedInput.data,
        );

        if (permissionDecision.behavior !== 'allow') {
          return this.buildErrorResult(
            block,
            permissionDecision.reason ??
              `Department runtime rejected ${block.name}`,
            startedAt,
          );
        }

        const rootViolation = this.getDepartmentRootViolation(
          tool,
          parsedInput.data,
          runtimePolicy,
        );
        if (rootViolation) {
          return this.buildErrorResult(block, rootViolation, startedAt);
        }
      }

      // Security check for BashTool: run claude-code's full security engine
      if (block.name === 'BashTool') {
        const command = (parsedInput.data as Record<string, unknown>).command;
        if (typeof command === 'string') {
          // Phase 1: Full 23-validator security check on entire command
          const securityResult = checkBashSecurity(command);
          if (!securityResult.allowed) {
            return this.buildErrorResult(
              block,
              `Security check failed: ${securityResult.reason}`,
              startedAt,
            );
          }

          // Phase 3: Split compound commands and check each sub-command
          const subCommands = splitCompoundCommand(command);
          for (const sub of subCommands) {
            const subTrimmed = sub.trim();
            if (!subTrimmed) continue;
            // Check if any sub-command is a dangerous entry point
            if (isDangerousCommand(subTrimmed)) {
              const subResult = checkBashSecurity(subTrimmed);
              if (!subResult.allowed) {
                return this.buildErrorResult(
                  block,
                  `Security check failed on sub-command "${subTrimmed}": ${subResult.reason}`,
                  startedAt,
                );
              }
            }
          }
        }
      }

      const result = await tool.call(parsedInput.data, this.context);

      return {
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
        result: result as ToolResult,
        isError: false,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return this.buildErrorResult(block, message, startedAt);
    }
  }

  private canRunInParallel(block: ToolUseBlock): boolean {
    const tool = this.tools.get(block.name) as UnknownTool | undefined;

    if (!tool || !tool.isEnabled()) {
      return false;
    }

    const parsedInput = tool.inputSchema.safeParse(block.input);

    if (!parsedInput.success) {
      return false;
    }

    try {
      return tool.isConcurrencySafe(parsedInput.data);
    } catch {
      return false;
    }
  }

  private buildErrorResult(
    block: ToolUseBlock,
    message: string,
    startedAt: number,
  ): ToolCallResult {
    return {
      toolUseId: block.id,
      toolName: block.name,
      input: block.input,
      result: {
        data: message,
      },
      isError: true,
      durationMs: Date.now() - startedAt,
    };
  }

  private getDepartmentRootViolation(
    tool: UnknownTool,
    input: Record<string, unknown>,
    runtimePolicy: DepartmentRuntimePolicy,
  ): string | null {
    if (tool.name === 'AgentTool' && !runtimePolicy.allowSubAgents) {
      return 'Department runtime rejected AgentTool: sub-agents are disabled for this run';
    }

    if (tool.name === 'BashTool') {
      return this.validateBashRoots(tool, input, runtimePolicy);
    }

    const candidatePaths = this.extractCandidatePaths(tool, input);
    if (candidatePaths.length === 0) {
      return null;
    }

    const readOnly = this.isToolReadOnly(tool, input);
    const allowedRoots = readOnly
      ? runtimePolicy.readRoots
      : runtimePolicy.writeRoots.length > 0
        ? runtimePolicy.writeRoots
        : runtimePolicy.readRoots;

    if (allowedRoots.length === 0) {
      return null;
    }

    for (const candidate of candidatePaths) {
      const resolved = this.resolveCandidatePath(candidate);
      if (!this.isWithinAnyRoot(resolved, allowedRoots)) {
        const rootLabel = readOnly ? 'read roots' : 'write roots';
        return `Department runtime denied ${tool.name}: ${resolved} is outside allowed ${rootLabel}`;
      }
    }

    return null;
  }

  private validateBashRoots(
    tool: UnknownTool,
    input: Record<string, unknown>,
    runtimePolicy: DepartmentRuntimePolicy,
  ): string | null {
    if (this.isToolReadOnly(tool, input)) {
      return null;
    }

    const cwd = path.resolve(this.context.workspacePath);
    if (
      runtimePolicy.writeRoots.length > 0 &&
      !this.isWithinAnyRoot(cwd, runtimePolicy.writeRoots)
    ) {
      return `Department runtime denied BashTool: workspace ${cwd} is outside allowed write roots`;
    }

    return null;
  }

  private extractCandidatePaths(
    tool: UnknownTool,
    input: Record<string, unknown>,
  ): string[] {
    const paths = new Set<string>();

    if (tool.getPath) {
      try {
        const resolvedPath = tool.getPath(input);
        if (typeof resolvedPath === 'string' && resolvedPath.trim()) {
          paths.add(resolvedPath.trim());
        }
      } catch {
        // Ignore tool-specific path resolution failures and fall back to known keys.
      }
    }

    const candidateKeys = ['file_path', 'path', 'notebook_path', 'workingDirectory'];
    for (const key of candidateKeys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) {
        paths.add(value.trim());
      }
    }

    return [...paths];
  }

  private resolveCandidatePath(candidate: string): string {
    return path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.context.workspacePath, candidate);
  }

  private isWithinAnyRoot(candidate: string, roots: string[]): boolean {
    const normalizedCandidate = this.normalizeRoot(candidate);
    return roots.some((root) => {
      const normalizedRoot = this.normalizeRoot(root);
      return (
        normalizedCandidate === normalizedRoot.slice(0, -1) ||
        normalizedCandidate.startsWith(normalizedRoot)
      );
    });
  }

  private normalizeRoot(root: string): string {
    const resolved = path.resolve(root);
    return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
  }

  private isToolReadOnly(
    tool: UnknownTool,
    input: Record<string, unknown>,
  ): boolean {
    try {
      return tool.isReadOnly(input);
    } catch {
      return false;
    }
  }
}

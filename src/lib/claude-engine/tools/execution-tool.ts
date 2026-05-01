import * as path from 'node:path';

import { z } from 'zod';

import { getExecutor } from '../../providers';
import { getProviderInventory } from '../../providers/provider-inventory';
import type {
  AppendMessageOptions,
  ExecutionToolId,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../../providers/types';
import type { Tool, ToolContext, ToolResult } from '../types';

/**
 * External coding executors that Claude Engine can invoke inside its tool loop.
 *
 * This abstraction is intentionally narrow:
 * - wraps high-privilege CLI coders such as Codex CLI / Claude Code CLI
 * - does not replace the normal file / shell / search / MCP tool registry
 */
export type AvailableExecutionTool = {
  id: ExecutionToolId;
  label: string;
  available: boolean;
  supportsMultiTurn: boolean;
  reason?: string;
};

export type ExecutionToolRunRequest = {
  tool: ExecutionToolId;
  prompt: string;
  workingDirectory: string;
  sessionHandle?: string;
  model?: string;
  timeoutMs?: number;
  runId?: string;
};

export type ExecutionToolRunResult = {
  tool: ExecutionToolId;
  handle: string;
  mode: 'single-turn' | 'multi-turn';
  status: TaskExecutionResult['status'];
  content: string;
  changedFiles: string[];
  supportsMultiTurn: boolean;
};

export type ExecutionToolRuntime = {
  listTools(): AvailableExecutionTool[];
  run(request: ExecutionToolRunRequest): Promise<ExecutionToolRunResult>;
};

const scopedExecutionToolRuntimes = new WeakMap<ToolContext, ExecutionToolRuntime>();
let globalExecutionToolRuntime: ExecutionToolRuntime | null = null;

const inputSchema = z.object({
  action: z.enum(['list', 'run']).describe('List available execution tools or run one'),
  tool: z.enum(['codex', 'claude-code']).optional().describe('Execution tool id; required when action=run'),
  prompt: z.string().optional().describe('Task prompt for the execution tool; required when action=run'),
  sessionHandle: z.string().optional().describe('Existing session/thread handle for continuing a multi-turn tool run'),
  model: z.string().optional().describe('Optional model override for the execution tool'),
  workingDirectory: z.string().optional().describe('Execution working directory, relative to the workspace root when not absolute'),
  timeoutMs: z.number().int().positive().max(60 * 60 * 1000).optional().describe('Optional timeout in milliseconds'),
});

type Input = z.infer<typeof inputSchema>;

const TOOL_LABELS: Record<ExecutionToolId, string> = {
  codex: 'Codex CLI',
  'claude-code': 'Claude Code CLI',
};

function normalizeWorkingDirectory(
  workspacePath: string,
  workingDirectory?: string,
): string {
  if (!workingDirectory?.trim()) {
    return workspacePath;
  }

  return path.isAbsolute(workingDirectory)
    ? path.resolve(workingDirectory)
    : path.resolve(workspacePath, workingDirectory);
}

function isExecutionToolAvailable(toolId: ExecutionToolId): {
  available: boolean;
  reason?: string;
} {
  const inventory = getProviderInventory();

  if (toolId === 'codex') {
    return inventory.providers.codex.installed
      ? { available: true }
      : { available: false, reason: 'Codex CLI 未安装或不在 PATH 中。' };
  }

  return inventory.providers.claudeCode.installed && inventory.providers.claudeCode.loginDetected
    ? { available: true }
    : { available: false, reason: 'Claude Code CLI 未安装或未检测到登录态。' };
}

function createRuntimeResult(
  tool: ExecutionToolId,
  mode: 'single-turn' | 'multi-turn',
  supportsMultiTurn: boolean,
  result: TaskExecutionResult,
): ExecutionToolRunResult {
  return {
    tool,
    handle: result.handle,
    mode,
    status: result.status,
    content: result.content,
    changedFiles: result.changedFiles,
    supportsMultiTurn,
  };
}

export function createDefaultExecutionToolRuntime(): ExecutionToolRuntime {
  return {
    listTools(): AvailableExecutionTool[] {
      return (['codex', 'claude-code'] as const).map((toolId) => {
        const executor = getExecutor(toolId);
        const availability = isExecutionToolAvailable(toolId);
        return {
          id: toolId,
          label: TOOL_LABELS[toolId],
          available: availability.available,
          supportsMultiTurn: executor.capabilities().supportsMultiTurn,
          ...(availability.reason ? { reason: availability.reason } : {}),
        };
      });
    },

    async run(request: ExecutionToolRunRequest): Promise<ExecutionToolRunResult> {
      const availability = isExecutionToolAvailable(request.tool);
      if (!availability.available) {
        throw new Error(availability.reason ?? `Execution tool ${request.tool} is unavailable`);
      }

      const executor = getExecutor(request.tool);
      const capabilities = executor.capabilities();

      if (request.sessionHandle?.trim()) {
        if (!capabilities.supportsMultiTurn) {
          throw new Error(`${TOOL_LABELS[request.tool]} 不支持多轮续接。`);
        }

        const result = await executor.appendMessage(
          request.sessionHandle.trim(),
          {
            prompt: request.prompt,
            model: request.model,
            workspace: request.workingDirectory,
            runId: request.runId,
          } satisfies AppendMessageOptions,
        );

        return createRuntimeResult(request.tool, 'multi-turn', capabilities.supportsMultiTurn, result);
      }

      const result = await executor.executeTask({
        workspace: request.workingDirectory,
        prompt: request.prompt,
        model: request.model,
        timeout: request.timeoutMs,
        runId: request.runId,
      } satisfies TaskExecutionOptions);

      return createRuntimeResult(
        request.tool,
        capabilities.supportsMultiTurn ? 'multi-turn' : 'single-turn',
        capabilities.supportsMultiTurn,
        result,
      );
    },
  };
}

export function setExecutionToolRuntime(runtime: ExecutionToolRuntime | null): void {
  globalExecutionToolRuntime = runtime;
}

export function bindExecutionToolRuntime(
  context: ToolContext,
  runtime: ExecutionToolRuntime,
): void {
  scopedExecutionToolRuntimes.set(context, runtime);
}

export function unbindExecutionToolRuntime(context: ToolContext): void {
  scopedExecutionToolRuntimes.delete(context);
}

export function getExecutionToolRuntime(context: ToolContext): ExecutionToolRuntime | null {
  return scopedExecutionToolRuntimes.get(context) ?? globalExecutionToolRuntime;
}

export const executionTool = {
  name: 'ExecutionTool',
  aliases: ['execution_tool', 'cli_tool'],
  inputSchema,
  inputJSONSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'run'],
        description: 'List available execution tools or run one',
      },
      tool: {
        type: 'string',
        enum: ['codex', 'claude-code'],
        description: 'Execution tool id; required when action=run',
      },
      prompt: {
        type: 'string',
        description: 'Task prompt for the execution tool; required when action=run',
      },
      sessionHandle: {
        type: 'string',
        description: 'Existing session/thread handle for continuing a multi-turn tool run',
      },
      model: {
        type: 'string',
        description: 'Optional model override for the execution tool',
      },
      workingDirectory: {
        type: 'string',
        description: 'Execution working directory, relative to the workspace root when not absolute',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional timeout in milliseconds',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  description: (input: Input) => {
    if (input.action === 'list') {
      return 'List local execution tools such as Codex CLI and Claude Code CLI';
    }
    return `Run a local execution tool${input.tool ? ` (${input.tool})` : ''}${input.sessionHandle ? ' and continue an existing session' : ''}`;
  },
  async call(args: Input, context: ToolContext): Promise<ToolResult<string>> {
    const runtime = getExecutionToolRuntime(context);
    if (!runtime) {
      return { data: 'No execution tool runtime configured for this Claude Engine session.' };
    }

    if (args.action === 'list') {
      return {
        data: JSON.stringify({
          tools: runtime.listTools(),
        }),
      };
    }

    if (!args.tool) {
      throw new Error('tool is required when action=run');
    }
    if (!args.prompt?.trim()) {
      throw new Error('prompt is required when action=run');
    }

    const result = await runtime.run({
      tool: args.tool,
      prompt: args.prompt.trim(),
      workingDirectory: normalizeWorkingDirectory(context.workspacePath, args.workingDirectory),
      ...(args.sessionHandle?.trim() ? { sessionHandle: args.sessionHandle.trim() } : {}),
      ...(args.model?.trim() ? { model: args.model.trim() } : {}),
      ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
    });

    return {
      data: JSON.stringify(result),
    };
  },
  isEnabled: () => true,
  isReadOnly: (input: Input) => input.action === 'list',
  isConcurrencySafe: (input: Input) => input.action === 'list',
  maxResultSizeChars: 50_000,
  getPath: (input: Input) => input.workingDirectory ?? '',
  isDestructive: (input: Input) => input.action === 'run',
} satisfies Tool<Input, string>;

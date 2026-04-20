/**
 * Claude Engine Tool 类型定义
 * 精简自 claude-code/src/Tool.ts，去掉 React/UI/AppState 依赖
 */

import type { z } from 'zod';

import type { Message } from './message';
import type { PermissionResult } from './permissions';

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ToolContext = {
  workspacePath: string;
  abortSignal: AbortSignal;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exec: (
    cmd: string,
    opts?: { cwd?: string; timeout?: number },
  ) => Promise<ExecResult>;
  additionalWorkingDirectories?: string[];
  readRoots?: string[];
  writeRoots?: string[];
};

export type ToolProgressData = Record<string, unknown>;

export type ToolProgress<P extends ToolProgressData = ToolProgressData> = {
  toolUseID: string;
  data: P;
};

export type ToolResult<T = string> = {
  data: T;
  newMessages?: Message[];
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export type Tool<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output = string,
  P extends ToolProgressData = ToolProgressData,
> = {
  readonly name: string;
  aliases?: string[];
  readonly inputSchema: z.ZodType<Input>;
  readonly inputJSONSchema?: Record<string, unknown>;
  description(input: Input): Promise<string> | string;
  call(
    args: Input,
    context: ToolContext,
    onProgress?: (progress: ToolProgress<P>) => void,
  ): Promise<ToolResult<Output>>;
  isEnabled(): boolean;
  isReadOnly(input: Input): boolean;
  isConcurrencySafe(input: Input): boolean;
  maxResultSizeChars: number;
  validateInput?(
    input: Input,
    context: ToolContext,
  ): Promise<ValidationResult>;
  getPath?(input: Input): string;
  /** 权限检查（与原版 checkPermissions 对齐） */
  checkPermissions?(input: Input, context: ToolContext): Promise<PermissionResult>;
  isSearchOrReadCommand?(input: Input): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  };
  /** 是否为破坏性操作 */
  isDestructive?(input: Input): boolean;
};

export type Tools = Tool[];

export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  if (tool.name === name) {
    return true;
  }

  return tool.aliases?.includes(name) ?? false;
}

export function findToolByName(
  tools: Tools,
  name: string,
): Tool | undefined {
  return tools.find((tool) => toolMatchesName(tool, name));
}

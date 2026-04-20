/**
 * Claude Engine Agent Backend
 *
 * In-process LLM execution via ClaudeEngine (M1-M8).
 * No subprocess, no gRPC — direct Anthropic API calls.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';

import { appendRunHistoryEntry } from '../agents/run-history';
import { createLogger } from '../logger';
import { emitRunEvent } from '../agents/run-events';
import { ClaudeEngine } from '../claude-engine/engine/claude-engine';
import {
  attachDepartmentRuntimeContext,
  type DepartmentRuntimePolicy,
  type ResolvedRequiredArtifact,
} from '../claude-engine/engine/tool-executor';
import { TranscriptStore, type UUID } from '../claude-engine/engine/transcript-store';
import type { ModelConfig as APIModelConfig } from '../claude-engine/api/types';
import type { Tool, ToolContext, ExecResult } from '../claude-engine/types';
import { createDefaultRegistry } from '../claude-engine/tools/registry';
import {
  bindAgentHandler,
  type AgentSpawnHandler,
} from '../claude-engine/tools/agent';
import {
  bindMcpResourceProvider,
  type McpResourceProvider,
} from '../claude-engine/tools/mcp-resources';
import { PermissionChecker } from '../claude-engine/permissions/checker';
import type {
  McpClientLike,
} from '../claude-engine/mcp/client';
import { McpManager } from '../claude-engine/mcp/manager';
import type {
  McpContentItem,
  McpResourceContent,
  McpServerConfig,
  McpServerState,
} from '../claude-engine/mcp/types';
import { isExecutionProfile, type ExecutionProfile } from '../execution/contracts';
import type { DepartmentRequiredArtifact, DepartmentRuntimeContract } from '../organization/contracts';
import { loadAIConfig } from '../providers/ai-config';
import type { Step } from '../types';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentEvent,
  AgentSession,
  AppendRunRequest,
  BackendRunConfig,
} from './types';
import type { ProviderId } from '../providers';

const log = createLogger('ClaudeEngineBackend');
const execAsync = promisify(execCallback);

type BackendRuntimePayload = {
  executionProfile?: ExecutionProfile;
  runtimeContract?: DepartmentRuntimeContract;
  toolset?: string;
  additionalWorkingDirectories?: string[];
};

type NormalizedRuntimeContract = {
  workspaceRoot: string;
  artifactRoot?: string;
  toolset?: DepartmentRuntimeContract['toolset'];
  permissionMode: NonNullable<DepartmentRuntimeContract['permissionMode']>;
  additionalWorkingDirectories: string[];
  readRoots: string[];
  writeRoots: string[];
  requiredArtifacts: ResolvedRequiredArtifact[];
  mcpServers: string[];
  allowSubAgents: boolean;
};

type DepartmentMcpSetup = {
  manager: McpManager | null;
  provider: McpResourceProvider;
  tools: Tool[];
  cleanup: () => Promise<void>;
};

type StoredApiKeys = {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  grok?: string;
};

function getApiKeysPath(): string {
  return path.join(process.env.HOME ?? '~', '.gemini', 'antigravity', 'api-keys.json');
}

function readStoredApiKeys(): StoredApiKeys {
  try {
    const keysPath = getApiKeysPath();
    if (!existsSync(keysPath)) return {};
    return JSON.parse(readFileSync(keysPath, 'utf-8')) as StoredApiKeys;
  } catch {
    return {};
  }
}

export function resolveApiBackedModelConfig(providerId: ProviderId, requestedModel?: string): APIModelConfig {
  const keys = readStoredApiKeys();
  const aiConfig = loadAIConfig();

  switch (providerId) {
    case 'claude-api':
      return {
        model: requestedModel ?? 'claude-sonnet-4-20250514',
        apiKey: keys.anthropic || process.env.ANTHROPIC_API_KEY || '',
        provider: 'anthropic',
      };
    case 'openai-api':
      return {
        model: requestedModel ?? 'gpt-4.1-mini',
        apiKey: keys.openai || process.env.OPENAI_API_KEY || '',
        provider: 'openai',
      };
    case 'native-codex':
      return {
        model: requestedModel ?? 'gpt-5.4',
        apiKey: '',
        provider: 'native-codex',
      };
    case 'gemini-api':
      return {
        model: requestedModel ?? 'gemini-2.5-flash',
        apiKey: keys.gemini || process.env.GEMINI_API_KEY || '',
        provider: 'gemini',
      };
    case 'grok-api':
      return {
        model: requestedModel ?? 'grok-3-mini',
        apiKey: keys.grok || process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
        provider: 'grok',
        baseUrl: process.env.GROK_BASE_URL,
      };
    case 'custom':
      return {
        model: requestedModel ?? aiConfig.customProvider?.defaultModel ?? 'gpt-4.1-mini',
        apiKey: aiConfig.customProvider?.apiKey || '',
        provider: 'openai',
        baseUrl: aiConfig.customProvider?.baseUrl,
      };
    default:
      throw new Error(`Unsupported API-backed provider: ${providerId}`);
  }
}

// ---------------------------------------------------------------------------
// Event channel (same pattern as other backends)
// ---------------------------------------------------------------------------

function createEventChannel<T>() {
  const items: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const push = (item: T) => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    items.push(item);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.({ value: undefined as T, done: true });
    }
  };

  async function* iterate(): AsyncIterable<T> {
    while (true) {
      if (items.length > 0) {
        yield items.shift() as T;
        continue;
      }
      if (closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }

  return { push, close, iterate };
}

// ---------------------------------------------------------------------------
// ToolContext factory — creates real FS + exec context
// ---------------------------------------------------------------------------

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeRuntimeContract(value: unknown): DepartmentRuntimeContract | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const contract = value as Record<string, unknown>;
  const normalized: Partial<DepartmentRuntimeContract> = {};

  if (typeof contract.workspaceRoot === 'string' && contract.workspaceRoot.trim()) {
    normalized.workspaceRoot = contract.workspaceRoot.trim();
  }
  if (typeof contract.artifactRoot === 'string' && contract.artifactRoot.trim()) {
    normalized.artifactRoot = contract.artifactRoot.trim();
  }
  if (typeof contract.executionClass === 'string' && contract.executionClass.trim()) {
    normalized.executionClass = contract.executionClass.trim() as DepartmentRuntimeContract['executionClass'];
  }
  if (typeof contract.toolset === 'string' && contract.toolset.trim()) {
    normalized.toolset = contract.toolset.trim() as DepartmentRuntimeContract['toolset'];
  }
  if (typeof contract.permissionMode === 'string' && contract.permissionMode.trim()) {
    normalized.permissionMode = contract.permissionMode.trim() as DepartmentRuntimeContract['permissionMode'];
  }

  const additionalWorkingDirectories = normalizeStringArray(contract.additionalWorkingDirectories);
  if (additionalWorkingDirectories) {
    normalized.additionalWorkingDirectories = additionalWorkingDirectories;
  }

  const readRoots = normalizeStringArray(contract.readRoots);
  if (readRoots) {
    normalized.readRoots = readRoots;
  }

  const writeRoots = normalizeStringArray(contract.writeRoots);
  if (writeRoots) {
    normalized.writeRoots = writeRoots;
  }

  const requiredArtifacts = Array.isArray(contract.requiredArtifacts)
    ? contract.requiredArtifacts
        .filter((artifact): artifact is DepartmentRequiredArtifact =>
          Boolean(artifact) && typeof artifact === 'object' && typeof (artifact as { path?: unknown }).path === 'string',
        )
        .map((artifact) => ({
          path: artifact.path.trim(),
          required: artifact.required !== false,
          ...(artifact.format ? { format: artifact.format } : {}),
          ...(artifact.description ? { description: artifact.description } : {}),
        }))
        .filter((artifact) => artifact.path.length > 0)
    : undefined;
  if (requiredArtifacts) {
    normalized.requiredArtifacts = requiredArtifacts;
  }

  const mcpServers = normalizeStringArray(contract.mcpServers);
  if (mcpServers) {
    normalized.mcpServers = mcpServers;
  }

  if (typeof contract.allowSubAgents === 'boolean') {
    normalized.allowSubAgents = contract.allowSubAgents;
  }

  return Object.keys(normalized).length > 0 ? normalized as DepartmentRuntimeContract : undefined;
}

function extractRuntimePayload(config: BackendRunConfig): BackendRuntimePayload {
  const raw = config as BackendRunConfig & BackendRuntimePayload;
  const runtimeContract = normalizeRuntimeContract(raw.runtimeContract);
  const additionalWorkingDirectories = normalizeStringArray(raw.additionalWorkingDirectories);
  return {
    executionProfile: isExecutionProfile(raw.executionProfile)
      ? raw.executionProfile
      : undefined,
    runtimeContract,
    toolset: typeof raw.toolset === 'string' && raw.toolset.trim()
      ? raw.toolset.trim()
      : runtimeContract?.toolset,
    additionalWorkingDirectories: additionalWorkingDirectories || runtimeContract?.additionalWorkingDirectories,
  };
}

function normalizeAdditionalWorkingDirectories(
  workspacePath: string,
  runtimePayload?: BackendRuntimePayload,
): string[] | undefined {
  const baseRoot = runtimePayload?.runtimeContract?.workspaceRoot || workspacePath;
  const normalized = runtimePayload?.additionalWorkingDirectories
    ?.map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(baseRoot, entry));

  if (!normalized || normalized.length === 0) {
    return undefined;
  }

  return [...new Set(normalized)];
}

function normalizeRootList(
  workspaceRoot: string,
  values: readonly string[] | undefined,
): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(workspaceRoot, entry)))];
}

function normalizeRequiredArtifacts(
  workspaceRoot: string,
  artifactRoot: string | undefined,
  values: readonly DepartmentRequiredArtifact[] | undefined,
): ResolvedRequiredArtifact[] {
  if (!values || values.length === 0) {
    return [];
  }

  const artifactBase = artifactRoot ?? workspaceRoot;
  return values
    .filter((artifact) => artifact.required !== false && artifact.path.trim().length > 0)
    .map((artifact) => ({
      ...artifact,
      path: artifact.path.trim(),
      absolutePath: path.isAbsolute(artifact.path)
        ? path.resolve(artifact.path)
        : path.resolve(artifactBase, artifact.path),
    }));
}

function normalizeResolvedRuntimeContract(
  workspacePath: string,
  runtimePayload?: BackendRuntimePayload,
  config?: BackendRunConfig,
): NormalizedRuntimeContract {
  const contract = runtimePayload?.runtimeContract;
  const workspaceRoot = path.resolve(contract?.workspaceRoot ?? workspacePath);
  const additionalWorkingDirectories = normalizeAdditionalWorkingDirectories(
    workspaceRoot,
    runtimePayload,
  ) ?? [];
  const artifactRoot = contract?.artifactRoot
    ? path.resolve(workspaceRoot, contract.artifactRoot)
    : config?.artifactDir
      ? (path.isAbsolute(config.artifactDir)
          ? path.resolve(config.artifactDir)
          : path.resolve(workspaceRoot, config.artifactDir))
      : undefined;

  const readRoots = normalizeRootList(workspaceRoot, contract?.readRoots);
  const writeRoots = normalizeRootList(
    workspaceRoot,
    contract?.writeRoots ?? config?.allowedWriteRoots,
  );

  const effectiveReadRoots = readRoots.length > 0
    ? [...new Set([workspaceRoot, ...readRoots, ...additionalWorkingDirectories])]
    : [...new Set([workspaceRoot, ...additionalWorkingDirectories])];

  const effectiveWriteRoots = writeRoots.length > 0
    ? [...new Set(writeRoots)]
    : [...new Set([
        artifactRoot ?? workspaceRoot,
        workspaceRoot,
        ...additionalWorkingDirectories,
      ])];

  return {
    workspaceRoot,
    ...(artifactRoot ? { artifactRoot } : {}),
    permissionMode: contract?.permissionMode ?? config?.permissionMode ?? 'default',
    ...(runtimePayload?.toolset ? { toolset: runtimePayload.toolset as DepartmentRuntimeContract['toolset'] } : {}),
    additionalWorkingDirectories,
    readRoots: effectiveReadRoots,
    writeRoots: effectiveWriteRoots,
    requiredArtifacts: normalizeRequiredArtifacts(
      workspaceRoot,
      artifactRoot,
      contract?.requiredArtifacts ?? config?.requiredArtifacts,
    ),
    mcpServers: contract?.mcpServers ?? [],
    allowSubAgents: contract?.allowSubAgents ?? false,
  };
}

function createPermissionCheckerForTools(
  toolNames: readonly string[],
  contract: NormalizedRuntimeContract,
): PermissionChecker {
  const checker = new PermissionChecker({
    mode: contract.permissionMode,
    cwd: contract.workspaceRoot,
  });

  for (const toolName of toolNames) {
    checker.addSessionRule(toolName, 'allow');
  }

  if (!contract.allowSubAgents) {
    checker.addRule({
      source: 'session',
      behavior: 'deny',
      value: { toolName: 'AgentTool' },
    });
  }

  return checker;
}

export function createClaudeEngineToolContext(
  workspacePath: string,
  signal: AbortSignal,
  additionalWorkingDirectories?: string[],
): ToolContext {
  const allowedExecutionRoots = [
    path.resolve(workspacePath),
    ...(additionalWorkingDirectories ?? []).map((entry) => path.resolve(entry)),
  ];

  return {
    workspacePath,
    abortSignal: signal,
    ...(additionalWorkingDirectories?.length
      ? { additionalWorkingDirectories }
      : {}),
    readFile: (filePath: string) => fs.readFile(filePath, 'utf8'),
    writeFile: (filePath: string, content: string) =>
      fs.writeFile(filePath, content, 'utf8'),
    exec: async (
      cmd: string,
      opts?: { cwd?: string; timeout?: number },
    ): Promise<ExecResult> => {
      try {
        const requestedCwd = path.resolve(opts?.cwd ?? workspacePath);
        if (!allowedExecutionRoots.some((root) => isPathWithinRoot(requestedCwd, root))) {
          throw new Error(
            `Execution denied: working directory ${requestedCwd} is outside Department runtime roots`,
          );
        }
        const result = await execAsync(cmd, {
          cwd: requestedCwd,
          timeout: opts?.timeout ?? 60_000,
          maxBuffer: 5_000_000,
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      } catch (error: unknown) {
        const e = error as Error & {
          code?: number | string;
          stdout?: string;
          stderr?: string;
        };
        return {
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message,
          exitCode: typeof e.code === 'number' ? e.code : 1,
        };
      }
    },
  };
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = ensureTrailingSeparator(path.resolve(candidate));
  const normalizedRoot = ensureTrailingSeparator(path.resolve(root));
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot)
  );
}

function ensureTrailingSeparator(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function dedupeTools(tools: readonly Tool[]): Tool[] {
  const seen = new Map<string, Tool>();
  for (const tool of tools) {
    if (!seen.has(tool.name)) {
      seen.set(tool.name, tool);
    }
  }
  return [...seen.values()];
}

function getMcpConfigPath(): string {
  return path.join(process.env.HOME ?? '~', '.gemini', 'antigravity', 'mcp_config.json');
}

function readConfiguredMcpServers(): McpServerConfig[] {
  try {
    const configPath = getMcpConfigPath();
    if (!existsSync(configPath)) {
      return [];
    }
    const content = JSON.parse(readFileSync(configPath, 'utf8')) as {
      servers?: Array<Record<string, unknown>>;
    };
    return (content.servers ?? [])
      .filter((server): server is Record<string, unknown> => Boolean(server))
      .map((server) => ({
        name: String(server.name ?? '').trim(),
        type: (server.type ?? 'stdio') as McpServerConfig['type'],
        ...(typeof server.command === 'string' ? { command: server.command } : {}),
        ...(Array.isArray(server.args)
          ? {
              args: server.args.filter((value): value is string => typeof value === 'string'),
            }
          : {}),
        ...(typeof server.url === 'string' ? { url: server.url } : {}),
        ...(server.env && typeof server.env === 'object'
          ? {
              env: Object.fromEntries(
                Object.entries(server.env).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              ),
            }
          : {}),
        ...(server.headers && typeof server.headers === 'object'
          ? {
              headers: Object.fromEntries(
                Object.entries(server.headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              ),
            }
          : {}),
      }))
      .filter((server) => server.name.length > 0);
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Failed to read MCP config for Claude Engine runtime',
    );
    return [];
  }
}

function getMcpClientsFromManager(manager: McpManager): Map<string, McpClientLike> {
  return (manager as unknown as { clients: Map<string, McpClientLike> }).clients;
}

function createEmptyMcpResourceProvider(): McpResourceProvider {
  return {
    listResources: async () => [],
    readResource: async () => [],
    getServerNames: () => [],
  };
}

function mapResourceContentToMcpItems(
  contents: readonly McpResourceContent[],
): McpContentItem[] {
  return contents.map((item) => {
    if (item.text !== undefined) {
      return { type: 'text' as const, text: item.text };
    }
    return {
      type: 'resource' as const,
      resource: {
        uri: item.uri,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        ...(item.blob ? { blob: item.blob } : {}),
      },
    };
  });
}

async function createDepartmentMcpSetup(
  contract: NormalizedRuntimeContract,
): Promise<DepartmentMcpSetup> {
  if (contract.mcpServers.length === 0) {
    return {
      manager: null,
      provider: createEmptyMcpResourceProvider(),
      tools: [],
      cleanup: async () => {},
    };
  }

  const configuredServers = readConfiguredMcpServers();
  const selectedServers = configuredServers.filter((server) =>
    contract.mcpServers.includes(server.name),
  );

  if (selectedServers.length === 0) {
    log.warn(
      { servers: contract.mcpServers },
      'Department runtime requested MCP servers that are not configured locally',
    );
    return {
      manager: null,
      provider: createEmptyMcpResourceProvider(),
      tools: [],
      cleanup: async () => {},
    };
  }

  const manager = new McpManager();
  for (const server of selectedServers) {
    try {
      await manager.addServer(server);
    } catch (error) {
      log.warn(
        {
          server: server.name,
          err: error instanceof Error ? error.message : String(error),
        },
        'Failed to connect Department MCP server',
      );
    }
  }

  const tools = await manager.getAllTools();
  const provider: McpResourceProvider = {
    listResources: async (serverName?: string) => {
      const clients = getMcpClientsFromManager(manager);
      const resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
        server: string;
      }> = [];
      for (const [name, client] of clients) {
        if (serverName && name !== serverName) {
          continue;
        }
        const state = client.getState();
        if (state.status !== 'connected') {
          continue;
        }
        const listed = await client.listResources();
        resources.push(...listed.map((resource) => ({ ...resource, server: name })));
      }
      return resources;
    },
    readResource: async (serverName: string, uri: string) => {
      const client = getMcpClientsFromManager(manager).get(serverName);
      if (!client) {
        throw new Error(`Unknown MCP server: ${serverName}`);
      }
      const state = client.getState();
      if (state.status !== 'connected') {
        throw new Error(`MCP server ${serverName} is not connected`);
      }
      const contents = await client.readResource(uri);
      return mapResourceContentToMcpItems(contents);
    },
    getServerNames: () =>
      [...getMcpClientsFromManager(manager).entries()]
        .filter((entry): entry is [string, McpClientLike] => {
          const state = entry[1].getState() as McpServerState;
          return state.status === 'connected';
        })
        .map(([name]) => name),
  };

  return {
    manager,
    provider,
    tools: tools as unknown as Tool[],
    cleanup: async () => {
      await manager.disconnectAll();
    },
  };
}

function createDepartmentRuntimePolicy(
  contract: NormalizedRuntimeContract,
  toolNames: readonly string[],
): DepartmentRuntimePolicy {
  return {
    permissionMode: contract.permissionMode,
    permissionChecker: createPermissionCheckerForTools(toolNames, contract),
    readRoots: contract.readRoots,
    writeRoots: contract.writeRoots,
    additionalWorkingDirectories: contract.additionalWorkingDirectories,
    ...(contract.artifactRoot ? { artifactRoot: contract.artifactRoot } : {}),
    requiredArtifacts: contract.requiredArtifacts,
    allowSubAgents: contract.allowSubAgents,
  };
}

function resolveAgentWorkingDirectory(
  requestPath: string,
  contract: NormalizedRuntimeContract,
): string {
  const candidate = path.isAbsolute(requestPath)
    ? path.resolve(requestPath)
    : path.resolve(contract.workspaceRoot, requestPath);
  const allowedRoots = [
    contract.workspaceRoot,
    ...contract.additionalWorkingDirectories,
    ...contract.readRoots,
  ];
  if (!allowedRoots.some((root) => isPathWithinRoot(candidate, root))) {
    throw new Error(
      `Department runtime denied AgentTool working directory ${candidate}`,
    );
  }
  return candidate;
}

function createDepartmentAgentHandler(options: {
  modelConfig: APIModelConfig;
  config: BackendRunConfig;
  contract: NormalizedRuntimeContract;
  tools: Tool[];
  mcpProvider: McpResourceProvider;
}): AgentSpawnHandler {
  return async (request, signal) => {
    if (!options.contract.allowSubAgents) {
      throw new Error(
        'Department runtime rejected AgentTool: sub-agents are disabled for this run',
      );
    }

    const workingDirectory = resolveAgentWorkingDirectory(
      request.workingDirectory,
      options.contract,
    );
    const subToolContext = createClaudeEngineToolContext(
      workingDirectory,
      signal,
      options.contract.additionalWorkingDirectories,
    );
    const subTools = options.tools.filter((tool) => tool.name !== 'AgentTool');
    const subPolicy = createDepartmentRuntimePolicy(
      {
        ...options.contract,
        allowSubAgents: false,
      },
      subTools.map((tool) => tool.name),
    );
    attachDepartmentRuntimeContext(subToolContext, subPolicy);
    bindMcpResourceProvider(subToolContext, options.mcpProvider);

    const engine = new ClaudeEngine({
      model: options.modelConfig,
      systemPrompt: buildClaudeEngineSystemPrompt({
        ...options.config,
        workspacePath: workingDirectory,
      }),
      tools: subTools,
      toolContext: subToolContext,
      toolset: options.contract.toolset,
      departmentRuntime: subPolicy,
      maxTurns: Math.max(1, Math.min(12, Math.trunc(request.timeout / 30) || 8)),
    });

    await engine.init();
    try {
      return await runClaudeEngineSimple(
        engine,
        `[Sub-agent:${request.agentType}]\n${request.prompt}`,
      );
    } finally {
      await closeClaudeEngine(engine);
    }
  };
}

function validateRequiredArtifacts(
  requiredArtifacts: readonly ResolvedRequiredArtifact[],
): string[] {
  return requiredArtifacts
    .filter((artifact) => artifact.required !== false)
    .filter((artifact) => !existsSync(artifact.absolutePath))
    .map((artifact) => artifact.path);
}

async function runClaudeEngineSimple(
  engine: ClaudeEngine,
  prompt: string,
): Promise<string> {
  if ('chatSimple' in engine && typeof engine.chatSimple === 'function') {
    return engine.chatSimple(prompt);
  }

  let finalText = '';
  for await (const event of engine.chat(prompt)) {
    if (event.type === 'text_delta') {
      finalText += event.text;
    }
  }
  return finalText;
}

async function closeClaudeEngine(engine: ClaudeEngine): Promise<void> {
  if ('close' in engine && typeof engine.close === 'function') {
    await engine.close();
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

class ClaudeEngineAgentSession implements AgentSession {
  readonly providerId: ProviderId;
  readonly capabilities: AgentBackendCapabilities = {
    supportsAppend: true,
    supportsCancel: true,
    emitsLiveState: false,
    emitsRawSteps: false,
    emitsStreamingText: true,
  };

  readonly handle: string;

  private readonly channel = createEventChannel<AgentEvent>();
  private engine: ClaudeEngine;
  private abortController: AbortController;
  private terminal = false;
  private cancelled = false;
  private cleanedUp = false;

  private constructor(
    readonly runId: string,
    private readonly config: BackendRunConfig,
    providerId: ProviderId,
    handle: string,
    engine: ClaudeEngine,
    abortController: AbortController,
    private readonly runtimeContract: NormalizedRuntimeContract,
    private readonly cleanup: () => Promise<void>,
    options: { startExecution?: boolean } = {},
  ) {
    this.providerId = providerId;
    this.handle = handle;
    this.abortController = abortController;
    this.engine = engine;

    this.channel.push({
      kind: 'started',
      runId,
      providerId: this.providerId,
      handle: this.handle,
      startedAt: new Date().toISOString(),
    });

    if (options.startExecution !== false) {
      void this.run(config.prompt);
    }
  }

  static async create(
    runId: string,
    config: BackendRunConfig,
    providerId: ProviderId,
  ): Promise<ClaudeEngineAgentSession> {
    const abortController = new AbortController();
    const modelConfig = resolveApiBackedModelConfig(providerId, config.model);
    const runtimePayload = extractRuntimePayload(config);
    const runtimeContract = normalizeResolvedRuntimeContract(
      config.workspacePath,
      runtimePayload,
      config,
    );
    if (!modelConfig.apiKey) {
      log.warn({ runId: runId.slice(0, 8), providerId }, 'Provider credential not configured');
    }

    const toolContext = createClaudeEngineToolContext(
      runtimeContract.workspaceRoot,
      abortController.signal,
      runtimeContract.additionalWorkingDirectories,
    );
    const mcpSetup = await createDepartmentMcpSetup(runtimeContract);
    bindMcpResourceProvider(toolContext, mcpSetup.provider);

    const baseTools = createDefaultRegistry().getAll();
    const mergedTools = dedupeTools([...baseTools, ...mcpSetup.tools]);
    const departmentPolicy = createDepartmentRuntimePolicy(
      runtimeContract,
      mergedTools.map((tool) => tool.name),
    );
    attachDepartmentRuntimeContext(toolContext, departmentPolicy);
    bindAgentHandler(
      toolContext,
      createDepartmentAgentHandler({
        modelConfig,
        config,
        contract: runtimeContract,
        tools: mergedTools,
        mcpProvider: mcpSetup.provider,
      }),
    );

    const engine = new ClaudeEngine({
      model: modelConfig,
      systemPrompt: buildClaudeEngineSystemPrompt(config),
      tools: mergedTools,
      toolContext,
      departmentRuntime: departmentPolicy,
      toolset: runtimePayload.toolset,
      maxTurns: 30,
    });
    await engine.init();
    const sessionId = engine.getSessionId();
    if (!sessionId) {
      throw new Error('ClaudeEngine session created without transcript session id');
    }

    return new ClaudeEngineAgentSession(
      runId,
      config,
      providerId,
      `${providerId}-${sessionId}`,
      engine,
      abortController,
      runtimeContract,
      mcpSetup.cleanup,
    );
  }

  static async attach(
    runId: string,
    config: BackendRunConfig,
    providerId: ProviderId,
    handle: string,
  ): Promise<ClaudeEngineAgentSession> {
    const prefix = `${providerId}-`;
    if (!handle.startsWith(prefix)) {
      throw new Error(`Cannot attach ${providerId} session: handle '${handle}' is not provider-scoped`);
    }

    const resumeSessionId = handle.slice(prefix.length);
    const abortController = new AbortController();
    const modelConfig = resolveApiBackedModelConfig(providerId, config.model);
    const runtimePayload = extractRuntimePayload(config);
    const runtimeContract = normalizeResolvedRuntimeContract(
      config.workspacePath,
      runtimePayload,
      config,
    );
    if (!modelConfig.apiKey) {
      log.warn({ runId: runId.slice(0, 8), providerId }, 'Provider credential not configured');
    }

    const toolContext = createClaudeEngineToolContext(
      runtimeContract.workspaceRoot,
      abortController.signal,
      runtimeContract.additionalWorkingDirectories,
    );
    const mcpSetup = await createDepartmentMcpSetup(runtimeContract);
    bindMcpResourceProvider(toolContext, mcpSetup.provider);

    const baseTools = createDefaultRegistry().getAll();
    const mergedTools = dedupeTools([...baseTools, ...mcpSetup.tools]);
    const departmentPolicy = createDepartmentRuntimePolicy(
      runtimeContract,
      mergedTools.map((tool) => tool.name),
    );
    attachDepartmentRuntimeContext(toolContext, departmentPolicy);
    bindAgentHandler(
      toolContext,
      createDepartmentAgentHandler({
        modelConfig,
        config,
        contract: runtimeContract,
        tools: mergedTools,
        mcpProvider: mcpSetup.provider,
      }),
    );

    const engine = new ClaudeEngine({
      model: modelConfig,
      systemPrompt: buildClaudeEngineSystemPrompt(config),
      tools: mergedTools,
      toolContext,
      departmentRuntime: departmentPolicy,
      toolset: runtimePayload.toolset,
      maxTurns: 30,
      resumeSessionId,
    });
    await engine.init();

    return new ClaudeEngineAgentSession(
      runId,
      config,
      providerId,
      handle,
      engine,
      abortController,
      runtimeContract,
      mcpSetup.cleanup,
      { startExecution: false },
    );
  }

  private async run(prompt: string): Promise<void> {
    try {
      appendRunHistoryEntry({
        runId: this.runId,
        provider: this.providerId,
        sessionHandle: this.handle,
        eventType: 'conversation.message.user',
        details: { content: prompt },
      });

      let finalText = '';
      const changedFiles: string[] = [];
      let totalUsage: { input_tokens: number; output_tokens: number } | undefined;

      for await (const event of this.engine.chat(prompt)) {
        if (this.cancelled || this.terminal) return;

        if (event.type === 'text_delta') {
          finalText += event.text;
          emitRunEvent({
            type: 'text_delta',
            runId: this.runId,
            timestamp: new Date().toISOString(),
            data: { text: event.text },
          });
        }

        if (event.type === 'tool_start') {
          emitRunEvent({
            type: 'tool_start',
            runId: this.runId,
            timestamp: new Date().toISOString(),
            data: { toolName: event.toolName, input: event.input },
          });
        }

        if (event.type === 'tool_end') {
          trackChangedFile(event.toolName, event.result, changedFiles);
          emitRunEvent({
            type: 'tool_end',
            runId: this.runId,
            timestamp: new Date().toISOString(),
            data: { toolName: event.toolName, result: event.result },
          });
        }

        if (event.type === 'complete') {
          totalUsage = event.totalUsage;
        }
      }

      if (this.cancelled || this.terminal) return;

      const missingArtifacts = validateRequiredArtifacts(
        this.runtimeContract.requiredArtifacts,
      );
      if (missingArtifacts.length > 0) {
        this.channel.push({
          kind: 'failed',
          runId: this.runId,
          providerId: this.providerId,
          handle: this.handle,
          finishedAt: new Date().toISOString(),
          error: {
            code: 'invalid_response',
            message: `Department runtime missing required artifacts: ${missingArtifacts.join(', ')}`,
            retryable: false,
            source: 'backend',
          },
        });
        emitRunEvent({
          type: 'failed',
          runId: this.runId,
          timestamp: new Date().toISOString(),
          data: { error: `Missing required artifacts: ${missingArtifacts.join(', ')}` },
        });
        this.terminal = true;
        this.channel.close();
        return;
      }

      this.channel.push({
        kind: 'completed',
        runId: this.runId,
        providerId: this.providerId,
        handle: this.handle,
        finishedAt: new Date().toISOString(),
        result: {
          status: 'completed',
          summary: finalText || 'Task completed',
          changedFiles,
          blockers: [],
          needsReview: [],
        },
        finalText,
        rawSteps: [],
        tokenUsage: totalUsage ? {
          inputTokens: totalUsage.input_tokens,
          outputTokens: totalUsage.output_tokens,
          totalTokens: totalUsage.input_tokens + totalUsage.output_tokens,
        } : undefined,
      });
      emitRunEvent({
        type: 'completed',
        runId: this.runId,
        timestamp: new Date().toISOString(),
        data: { summary: finalText, changedFiles, tokenUsage: totalUsage },
      });
      appendRunHistoryEntry({
        runId: this.runId,
        provider: this.providerId,
        sessionHandle: this.handle,
        eventType: 'conversation.message.assistant',
        details: { content: finalText },
      });
      this.terminal = true;
      this.channel.close();
    } catch (err: unknown) {
      if (this.cancelled || this.terminal) return;

      const message =
        err instanceof Error ? err.message : 'ClaudeEngine execution failed';

      this.channel.push({
        kind: 'failed',
        runId: this.runId,
        providerId: this.providerId,
        handle: this.handle,
        finishedAt: new Date().toISOString(),
        error: {
          code: 'provider_failed',
          message,
          retryable: true,
          source: 'provider',
        },
      });
      emitRunEvent({
        type: 'failed',
        runId: this.runId,
        timestamp: new Date().toISOString(),
        data: { error: message },
      });
      this.terminal = true;
      this.channel.close();
    } finally {
      await this.performCleanup();
    }
  }

  events(): AsyncIterable<AgentEvent> {
    return this.channel.iterate();
  }

  async append(request: AppendRunRequest): Promise<void> {
    if (this.terminal || this.cancelled) {
      throw new Error('Session is no longer active');
    }

    void this.run(request.prompt);
  }

  async cancel(reason?: string): Promise<void> {
    if (this.terminal || this.cancelled) return;
    this.cancelled = true;
    this.abortController.abort();

    this.channel.push({
      kind: 'cancelled',
      runId: this.runId,
      providerId: this.providerId,
      handle: this.handle,
      finishedAt: new Date().toISOString(),
      reason,
    });
    this.terminal = true;
    this.channel.close();
    await this.performCleanup();
  }

  private async performCleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }
    this.cleanedUp = true;
    try {
      await this.cleanup();
    } finally {
      await closeClaudeEngine(this.engine);
    }
  }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class ClaudeEngineAgentBackend implements AgentBackend {
  readonly providerId: ProviderId;

  constructor(providerId: ProviderId = 'claude-api') {
    this.providerId = providerId;
  }

  capabilities(): AgentBackendCapabilities {
    return {
      supportsAppend: true,
      supportsCancel: true,
      emitsLiveState: false,
      emitsRawSteps: false,
      emitsStreamingText: true,
      departmentRuntime: {
        supportsDepartmentRuntime: true,
        supportsToolRuntime: true,
        supportsArtifactContracts: true,
        supportsReadWriteAudit: true,
        supportsPermissionEnforcement: true,
        supportsReviewLoops: true,
      },
    };
  }

  async start(config: BackendRunConfig): Promise<AgentSession> {
    return ClaudeEngineAgentSession.create(config.runId, config, this.providerId);
  }

  async attach(config: BackendRunConfig, handle: string): Promise<AgentSession> {
    return ClaudeEngineAgentSession.attach(config.runId, config, this.providerId, handle);
  }

  async getRecentSteps(handle: string, options?: { limit?: number }): Promise<unknown[]> {
    const prefix = `${this.providerId}-`;
    if (!handle.startsWith(prefix)) {
      return [];
    }

    const sessionId = handle.slice(prefix.length) as UUID;
    const store = new TranscriptStore();
    try {
      const messages = await store.loadMessagesForResume(sessionId);
      const steps = messages.flatMap<Step>((message) => {
        const content = typeof message.content === 'string'
          ? message.content
          : message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
        if (!content.trim()) {
          return [];
        }
        if (message.role === 'user') {
          return [{
            type: 'CORTEX_STEP_TYPE_USER_INPUT' as const,
            userInput: { items: [{ text: content }], media: [] },
          }];
        }
        return [{
          type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' as const,
          plannerResponse: { response: content },
        }];
      });

      if (!options?.limit || options.limit <= 0) {
        return steps;
      }
      return steps.slice(-options.limit);
    } finally {
      await store.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildClaudeEngineSystemPrompt(config: BackendRunConfig): string {
  const parts: string[] = [];
  const runtimePayload = extractRuntimePayload(config);

  parts.push('You are an expert coding assistant.');

  if (config.metadata?.roleId) {
    parts.push(`Role: ${config.metadata.roleId}`);
  }

  if (config.artifactDir) {
    parts.push(
      `Write output artifacts to the directory: ${config.artifactDir}`,
    );
  }

  parts.push(`Workspace: ${config.workspacePath}`);

  if (runtimePayload.executionProfile) {
    parts.push('\n<execution-profile>');
    parts.push(JSON.stringify(runtimePayload.executionProfile));
    parts.push('</execution-profile>');
  }

  if (runtimePayload.runtimeContract) {
    const contract = runtimePayload.runtimeContract;
    const contractLines = ['<department-runtime-contract>'];

    if (contract.workspaceRoot) {
      contractLines.push(`Workspace root: ${contract.workspaceRoot}`);
    }
    if (contract.artifactRoot) {
      contractLines.push(`Artifact root: ${contract.artifactRoot}`);
    }
    if (contract.executionClass) {
      contractLines.push(`Execution class: ${contract.executionClass}`);
    }
    if (contract.permissionMode) {
      contractLines.push(`Permission mode: ${contract.permissionMode}`);
    }
    if (contract.toolset) {
      contractLines.push(`Toolset: ${contract.toolset}`);
    }
    if (contract.additionalWorkingDirectories?.length) {
      contractLines.push(`Additional working directories: ${contract.additionalWorkingDirectories.join(', ')}`);
    }
    if (contract.readRoots?.length) {
      contractLines.push(`Read roots: ${contract.readRoots.join(', ')}`);
    }
    if (contract.writeRoots?.length) {
      contractLines.push(`Write roots: ${contract.writeRoots.join(', ')}`);
    }
    if (contract.requiredArtifacts?.length) {
      contractLines.push(`Required artifacts: ${contract.requiredArtifacts.map((artifact) => artifact.path).join(', ')}`);
    }

    contractLines.push('</department-runtime-contract>');
    parts.push(`\n${contractLines.join('\n')}`);
  }

  // Inject department memory context if available
  if (config.memoryContext) {
    const memParts: string[] = [];
    for (const entry of config.memoryContext.departmentMemories ?? []) {
      if (entry.content.trim()) memParts.push(`[${entry.name}]\n${entry.content}`);
    }
    for (const entry of config.memoryContext.projectMemories ?? []) {
      if (entry.content.trim()) memParts.push(`[${entry.name}]\n${entry.content}`);
    }
    for (const entry of config.memoryContext.userPreferences ?? []) {
      if (entry.content.trim()) memParts.push(`[${entry.name}]\n${entry.content}`);
    }
    if (memParts.length > 0) {
      parts.push('\n<department-memory>');
      parts.push(memParts.join('\n\n'));
      parts.push('</department-memory>');
    }
  }

  return parts.join('\n');
}

function trackChangedFile(
  toolName: string,
  result: { data: unknown },
  changedFiles: string[],
): void {
  if (
    toolName === 'FileWriteTool' ||
    toolName === 'FileEditTool'
  ) {
    const data = String(result.data);
    // Extract file path from result like "Wrote 5 lines to /path/file.ts"
    // or "Edited /path/file.ts: replaced 1 occurrence(s)"
    const pathMatch = /(?:to|Edited)\s+(.+?)(?::|$)/i.exec(data);
    if (pathMatch?.[1]) {
      const filePath = pathMatch[1].trim();
      if (!changedFiles.includes(filePath)) {
        changedFiles.push(filePath);
      }
    }
  }
}

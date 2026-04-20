import {
  spawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';

import {
  createIdGenerator,
  parseResponse,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from './json-rpc';

export type StdioTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

type SpawnFn = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptionsWithoutStdio,
) => ChildProcess;

type StdioTransportDependencies = {
  spawn?: SpawnFn;
  createId?: () => number;
};

export class StdioTransport {
  private process: ChildProcess | null = null;
  private buffer = '';
  private pendingRequests: Map<
    number,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private notificationHandler?: (notification: JsonRpcNotification) => void;
  private nextId: () => number;
  private spawnImpl: SpawnFn;

  constructor(
    private options: StdioTransportOptions,
    dependencies: StdioTransportDependencies = {},
  ) {
    this.nextId = dependencies.createId ?? createIdGenerator();
    this.spawnImpl = dependencies.spawn ?? spawn;
  }

  async connect(): Promise<void> {
    if (this.process) {
      return;
    }

    const child = this.spawnImpl(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...(this.options.env ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to create stdio transport pipes');
    }

    this.process = child;
    child.stdout.on('data', (chunk: Buffer | string) => {
      this.handleData(
        typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
      );
    });
    child.on('error', (error) => {
      const transportError =
        error instanceof Error ? error : new Error(String(error));
      this.rejectAll(transportError);
      this.process = null;
    });
    child.on('exit', () => {
      this.rejectAll(new Error('MCP stdio transport closed'));
      this.process = null;
    });
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error('MCP stdio transport is not connected');
    }

    const id = this.nextId();
    const payload = `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    })}\n`;

    return await new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }

          resolve(response.result);
        },
        reject,
      });

      try {
        this.process?.stdin?.write(payload);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      throw new Error('MCP stdio transport is not connected');
    }

    const payload = `${JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    })}\n`;

    this.process.stdin.write(payload);
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  async close(): Promise<void> {
    if (!this.process) {
      return;
    }

    const child = this.process;
    this.process = null;
    this.rejectAll(new Error('MCP stdio transport closed'));

    child.stdin?.end();
    child.kill();
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = parseResponse(line);
          this.handleMessage(message);
        } catch (error) {
          const transportError =
            error instanceof Error ? error : new Error(String(error));
          this.rejectAll(transportError);
        }
      }

      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ('method' in msg && !('id' in msg)) {
      this.notificationHandler?.(msg);
      return;
    }

    const pending = this.pendingRequests.get(msg.id as number);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(msg.id as number);
    pending.resolve(msg as JsonRpcResponse);
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }

    this.pendingRequests.clear();
  }
}
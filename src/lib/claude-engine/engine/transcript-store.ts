import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, appendFile, writeFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { APIMessage, APIContentBlock } from '../api/types';

// ─── Types ──────────────────────────────────────────────────────────

export type UUID = string;

export type TranscriptEntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'metadata';

export type TranscriptEntry = {
  type: TranscriptEntryType;
  uuid: UUID;
  parentUuid: UUID | null;
  sessionId: UUID;
  timestamp: string;
  cwd: string;
  message?: APIMessage;
  /** System message text */
  systemText?: string;
  /** Summary text for compaction boundaries */
  summaryText?: string;
  /** Arbitrary metadata */
  meta?: Record<string, unknown>;
};

export type SessionInfo = {
  sessionId: UUID;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** First user message preview */
  preview: string;
  filePath: string;
  sizeBytes: number;
};

export type LoadedSession = {
  sessionId: UUID;
  messages: APIMessage[];
  entries: TranscriptEntry[];
  metadata: Record<string, unknown>;
};

export type TranscriptStoreConfig = {
  /** Base directory for session files. Default: ~/.claude-engine/sessions */
  baseDir?: string;
  /** Project identifier for project-local sessions */
  projectId?: string;
  /** Flush interval for batched writes (ms). Default: 100 */
  flushIntervalMs?: number;
  /** Max transcript file size before rotation (bytes). Default: 50MB */
  maxFileSizeBytes?: number;
  /** Disable persistence entirely */
  disabled?: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(homedir(), '.claude-engine', 'sessions');
const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ─── TranscriptStore ────────────────────────────────────────────────

export class TranscriptStore {
  private baseDir: string;
  private flushIntervalMs: number;
  private maxFileSizeBytes: number;
  private disabled: boolean;

  // Write buffering
  private writeQueue: Map<string, TranscriptEntry[]> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(private config: TranscriptStoreConfig = {}) {
    const projectSubdir = config.projectId
      ? join(config.baseDir ?? DEFAULT_BASE_DIR, sanitizePath(config.projectId))
      : config.baseDir ?? DEFAULT_BASE_DIR;

    this.baseDir = projectSubdir;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    this.disabled = config.disabled ?? false;
  }

  // ── Session File Path ───────────────────────────────────────────

  private sessionFilePath(sessionId: UUID): string {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }

  // ── Initialize ──────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  // ── Append Entry ────────────────────────────────────────────────

  /**
   * Append a transcript entry to a session file.
   * Writes are buffered and flushed periodically.
   */
  async appendEntry(entry: TranscriptEntry): Promise<void> {
    if (this.disabled) return;

    const filePath = this.sessionFilePath(entry.sessionId);

    let queue = this.writeQueue.get(filePath);
    if (!queue) {
      queue = [];
      this.writeQueue.set(filePath, queue);
    }
    queue.push(entry);

    this.scheduleDrain();
  }

  /**
   * Append a user or assistant message to a session.
   * Automatically creates UUID, parentUuid chain, and timestamp.
   */
  async appendMessage(
    sessionId: UUID,
    message: APIMessage,
    parentUuid: UUID | null = null,
    cwd: string = process.cwd(),
  ): Promise<UUID> {
    const uuid = randomUUID();
    const entry: TranscriptEntry = {
      type: message.role as TranscriptEntryType,
      uuid,
      parentUuid,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd,
      message,
    };

    await this.appendEntry(entry);
    return uuid;
  }

  /**
   * Append a chain of messages (user + assistant pairs).
   * Automatically links parentUuid between them.
   */
  async appendMessageChain(
    sessionId: UUID,
    messages: APIMessage[],
    startingParentUuid: UUID | null = null,
    cwd: string = process.cwd(),
  ): Promise<UUID[]> {
    const uuids: UUID[] = [];
    let parentUuid = startingParentUuid;

    for (const message of messages) {
      const uuid = await this.appendMessage(sessionId, message, parentUuid, cwd);
      uuids.push(uuid);
      parentUuid = uuid;
    }

    return uuids;
  }

  /**
   * Append a summary entry (compaction boundary marker).
   */
  async appendSummary(
    sessionId: UUID,
    summaryText: string,
    leafUuid: UUID,
  ): Promise<void> {
    const entry: TranscriptEntry = {
      type: 'summary',
      uuid: randomUUID(),
      parentUuid: leafUuid,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      summaryText,
    };

    await this.appendEntry(entry);
  }

  /**
   * Append a metadata entry.
   */
  async appendMetadata(
    sessionId: UUID,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const entry: TranscriptEntry = {
      type: 'metadata',
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      meta,
    };

    await this.appendEntry(entry);
  }

  // ── Load Session ────────────────────────────────────────────────

  /**
   * Load a complete session from its JSONL file.
   */
  async loadSession(sessionId: UUID): Promise<LoadedSession | null> {
    // Flush any pending writes first
    await this.flush();

    const filePath = this.sessionFilePath(sessionId);

    try {
      const fileInfo = await stat(filePath);
      if (fileInfo.size > this.maxFileSizeBytes) {
        throw new Error(
          `Session file too large: ${fileInfo.size} bytes (max ${this.maxFileSizeBytes}). ` +
          `Consider compacting the session.`
        );
      }

      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      const entries: TranscriptEntry[] = [];
      const messages: APIMessage[] = [];
      let metadata: Record<string, unknown> = {};

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          entries.push(entry);

          if (entry.message && (entry.type === 'user' || entry.type === 'assistant')) {
            messages.push(entry.message);
          }

          if (entry.type === 'metadata' && entry.meta) {
            metadata = { ...metadata, ...entry.meta };
          }
        } catch {
          // Skip malformed lines
          continue;
        }
      }

      return { sessionId, messages, entries, metadata };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Load messages from a session for conversation resume.
   * Deserializes and validates messages for API use.
   */
  async loadMessagesForResume(sessionId: UUID): Promise<APIMessage[]> {
    const session = await this.loadSession(sessionId);
    if (!session) return [];

    // Build message chain from parentUuid linkage
    const byUuid = new Map<UUID, TranscriptEntry>();
    for (const entry of session.entries) {
      byUuid.set(entry.uuid, entry);
    }

    // Find the last entry (tip of the chain)
    const messageEntries = session.entries.filter(
      e => e.type === 'user' || e.type === 'assistant',
    );
    if (messageEntries.length === 0) return [];

    // Walk backward from the last entry to build the chain
    const lastEntry = messageEntries[messageEntries.length - 1]!;
    const chain: TranscriptEntry[] = [];
    let current: TranscriptEntry | undefined = lastEntry;

    while (current) {
      chain.unshift(current);
      if (current.parentUuid) {
        current = byUuid.get(current.parentUuid);
      } else {
        break;
      }
    }

    // Extract messages and filter unresolved tool_use
    const messages = chain
      .filter(e => e.message)
      .map(e => e.message!);

    return filterUnresolvedToolUses(messages);
  }

  // ── List Sessions ───────────────────────────────────────────────

  /**
   * List all sessions with metadata.
   */
  async listSessions(): Promise<SessionInfo[]> {
    await this.flush();

    try {
      const files = await readdir(this.baseDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      const sessions: SessionInfo[] = [];

      for (const file of jsonlFiles) {
        const filePath = join(this.baseDir, file);
        const sessionId = basename(file, '.jsonl');

        try {
          const fileInfo = await stat(filePath);
          const content = await readFile(filePath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim().length > 0);

          // Parse first user message for preview
          let preview = '';
          let createdAt = '';
          let updatedAt = '';
          let messageCount = 0;

          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as TranscriptEntry;
              if (!createdAt) createdAt = entry.timestamp;
              updatedAt = entry.timestamp;

              if (entry.type === 'user' || entry.type === 'assistant') {
                messageCount++;
              }

              if (entry.type === 'user' && !preview && entry.message) {
                preview = extractPreview(entry.message, 100);
              }
            } catch {
              continue;
            }
          }

          sessions.push({
            sessionId,
            createdAt,
            updatedAt,
            messageCount,
            preview,
            filePath,
            sizeBytes: fileInfo.size,
          });
        } catch {
          continue;
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      return sessions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  // ── Delete Session ──────────────────────────────────────────────

  /**
   * Delete a session file.
   */
  async deleteSession(sessionId: UUID): Promise<boolean> {
    const filePath = this.sessionFilePath(sessionId);
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  // ── Create New Session ──────────────────────────────────────────

  /**
   * Create a new session and return its ID.
   */
  async createSession(meta?: Record<string, unknown>): Promise<UUID> {
    const sessionId = randomUUID();

    if (meta) {
      await this.appendMetadata(sessionId, {
        ...meta,
        createdAt: new Date().toISOString(),
      });
    }

    return sessionId;
  }

  // ── Flush / Drain ────────────────────────────────────────────────

  private scheduleDrain(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.drain();
    }, this.flushIntervalMs);
  }

  private async drain(): Promise<void> {
    if (this.writeQueue.size === 0) return;

    await this.ensureDir();

    const snapshot = new Map(this.writeQueue);
    this.writeQueue.clear();

    for (const [filePath, entries] of snapshot) {
      const content = entries
        .map(entry => JSON.stringify(entry))
        .join('\n') + '\n';

      await appendFile(filePath, content, 'utf-8');
    }
  }

  /**
   * Force flush all pending writes to disk.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    await this.drain();

    if (this.flushPromise) {
      await this.flushPromise;
    }
  }

  /**
   * Close the store and flush remaining writes.
   */
  async close(): Promise<void> {
    await this.flush();
  }

  // ── Getters ─────────────────────────────────────────────────────

  getBaseDir(): string {
    return this.baseDir;
  }

  isDisabled(): boolean {
    return this.disabled;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Sanitize a path component for use as directory name.
 */
function sanitizePath(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

/**
 * Extract a text preview from an API message.
 */
function extractPreview(message: APIMessage, maxLength: number): string {
  if (typeof message.content === 'string') {
    return message.content.slice(0, maxLength);
  }

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'text') {
        return block.text.slice(0, maxLength);
      }
    }
  }

  return '';
}

/**
 * Filter out tool_use blocks that don't have matching tool_result.
 * This handles interrupted conversations where tool execution was not completed.
 */
function filterUnresolvedToolUses(messages: APIMessage[]): APIMessage[] {
  // Collect all tool_result IDs
  const resolvedToolIds = new Set<string>();
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          resolvedToolIds.add(block.tool_use_id);
        }
      }
    }
  }

  // Filter messages: remove unresolved tool_use blocks from the last assistant message
  const result: APIMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const isLast = i === messages.length - 1;

    if (isLast && msg.role === 'assistant' && Array.isArray(msg.content)) {
      const filteredContent = msg.content.filter(block => {
        if (block.type === 'tool_use') {
          return resolvedToolIds.has(block.id);
        }
        return true;
      });

      if (filteredContent.length > 0) {
        result.push({ ...msg, content: filteredContent });
      }
      // If all content was tool_use without results, drop the message
    } else {
      result.push(msg);
    }
  }

  return result;
}

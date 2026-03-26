/**
 * Antigravity Plugin — Structured Logger
 *
 * Ring-buffer logger for troubleshooting. Logs are stored in memory
 * and can be exported via the "Export Debug Logs" command.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;

class Logger {
  private entries: LogEntry[] = [];
  private minLevel: LogLevel = 'INFO';

  /** Set the minimum log level. Messages below this level are discarded. */
  setLevel(level: LogLevel) {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  debug(source: string, message: string, data?: unknown) {
    this.log('DEBUG', source, message, data);
  }

  info(source: string, message: string, data?: unknown) {
    this.log('INFO', source, message, data);
  }

  warn(source: string, message: string, data?: unknown) {
    this.log('WARN', source, message, data);
  }

  error(source: string, message: string, data?: unknown) {
    this.log('ERROR', source, message, data);
  }

  private log(level: LogLevel, source: string, message: string, data?: unknown) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      ...(data !== undefined ? { data } : {}),
    };

    this.entries.push(entry);

    // Ring buffer: discard oldest when exceeding max
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    // Also output to browser console for development
    const tag = `[Antigravity][${source}]`;
    switch (level) {
      case 'DEBUG': console.debug(tag, message, data ?? ''); break;
      case 'INFO':  console.log(tag, message, data ?? '');   break;
      case 'WARN':  console.warn(tag, message, data ?? '');  break;
      case 'ERROR': console.error(tag, message, data ?? ''); break;
    }
  }

  /** Get all stored log entries. */
  getEntries(): ReadonlyArray<LogEntry> {
    return this.entries;
  }

  /** Export logs as a human-readable text block. */
  exportAsText(): string {
    if (this.entries.length === 0) return '(No logs recorded)';

    const lines: string[] = [
      `=== Antigravity Debug Logs ===`,
      `Exported: ${new Date().toISOString()}`,
      `Entries: ${this.entries.length}`,
      `Log level: ${this.minLevel}`,
      `---`,
    ];

    for (const e of this.entries) {
      let line = `${e.timestamp} [${e.level.padEnd(5)}] [${e.source}] ${e.message}`;
      if (e.data !== undefined) {
        try {
          line += ` | ${JSON.stringify(e.data)}`;
        } catch {
          line += ` | [unserializable data]`;
        }
      }
      lines.push(line);
    }

    return lines.join('\n');
  }

  /** Clear all stored entries. */
  clear() {
    this.entries = [];
  }
}

/** Singleton logger instance shared across the plugin. */
export const logger = new Logger();

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

import { GATEWAY_HOME } from './gateway-home';

export interface RunHistoryEntry {
  timestamp: string;
  eventType: string;
  runId: string;
  provider?: string;
  sessionHandle?: string;
  details: Record<string, unknown>;
}

function runHistoryDir(runId: string): string {
  return path.join(GATEWAY_HOME, 'runs', runId);
}

export function runHistoryPath(runId: string): string {
  return path.join(runHistoryDir(runId), 'run-history.jsonl');
}

export function appendRunHistoryEntry(
  input: Omit<RunHistoryEntry, 'timestamp'>,
): RunHistoryEntry {
  const entry: RunHistoryEntry = {
    timestamp: new Date().toISOString(),
    ...input,
  };

  const dir = runHistoryDir(input.runId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  appendFileSync(runHistoryPath(input.runId), `${JSON.stringify(entry)}\n`, 'utf-8');
  return entry;
}

export function readRunHistory(runId: string): RunHistoryEntry[] {
  const fp = runHistoryPath(runId);
  if (!existsSync(fp)) return [];
  return readFileSync(fp, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunHistoryEntry);
}

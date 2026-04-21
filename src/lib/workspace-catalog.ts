import fs from 'fs';
import path from 'path';

import { getCEOWorkspacePath } from './agents/ceo-environment';
import { getWorkspaces as getAntigravityRecentWorkspaces } from './bridge/statedb';
import {
  getWorkspaceCatalogRecordByUri,
  listWorkspaceCatalogRecords,
  type WorkspaceCatalogRecord,
  type WorkspaceCatalogSourceKind,
  upsertWorkspaceCatalogRecord,
} from './storage/gateway-db';

export interface KnownWorkspace {
  uri: string;
  path: string;
  name: string;
  kind: 'folder' | 'workspace';
  sourceKind: WorkspaceCatalogSourceKind;
  status: WorkspaceCatalogRecord['status'];
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

function ensureAbsolutePath(inputPath: string): string {
  const cleaned = inputPath.trim();
  if (!cleaned) {
    throw new Error('Missing workspace path');
  }

  return path.isAbsolute(cleaned) ? cleaned : path.resolve(cleaned);
}

function toRealPathIfPossible(workspacePath: string): string {
  const absolutePath = ensureAbsolutePath(workspacePath);
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

export function workspaceUriToPath(workspaceUri: string): string {
  const rawPath = workspaceUri.replace(/^file:\/\//, '');
  return toRealPathIfPossible(rawPath);
}

export function workspacePathToUri(workspacePath: string): string {
  return `file://${toRealPathIfPossible(workspacePath)}`;
}

export function normalizeWorkspaceIdentity(input: string): { uri: string; path: string } {
  const workspacePath = input.startsWith('file://')
    ? workspaceUriToPath(input)
    : toRealPathIfPossible(input);
  return {
    uri: workspacePathToUri(workspacePath),
    path: workspacePath,
  };
}

function toKnownWorkspace(record: WorkspaceCatalogRecord): KnownWorkspace {
  return {
    uri: record.workspaceUri,
    path: record.workspacePath,
    name: record.displayName,
    kind: record.workspaceKind,
    sourceKind: record.sourceKind,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastSeenAt: record.lastSeenAt,
  };
}

export function registerWorkspace(input: {
  workspace: string;
  sourceKind: WorkspaceCatalogSourceKind;
  workspaceKind?: 'folder' | 'workspace';
  allowMissing?: boolean;
}): KnownWorkspace {
  const normalized = normalizeWorkspaceIdentity(input.workspace);
  if (!input.allowMissing && !fs.existsSync(normalized.path)) {
    throw new Error(`Workspace path does not exist: ${normalized.path}`);
  }

  const now = new Date().toISOString();
  const existing = getWorkspaceCatalogRecordByUri(normalized.uri);
  const record = upsertWorkspaceCatalogRecord({
    workspaceUri: normalized.uri,
    workspacePath: normalized.path,
    displayName: path.basename(normalized.path) || normalized.path,
    workspaceKind: input.workspaceKind ?? existing?.workspaceKind ?? 'folder',
    sourceKind: input.sourceKind,
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastSeenAt: input.sourceKind === 'antigravity-recent' ? now : existing?.lastSeenAt,
  });

  return toKnownWorkspace(record);
}

export function syncWorkspaceCatalogFromAntigravityRecent(): KnownWorkspace[] {
  const recent = getAntigravityRecentWorkspaces();

  for (const workspace of recent) {
    const rawPath = workspace.uri.replace(/^file:\/\//, '');
    if (!rawPath || !fs.existsSync(rawPath)) {
      continue;
    }

    registerWorkspace({
      workspace: rawPath,
      sourceKind: 'antigravity-recent',
      workspaceKind: workspace.type,
    });
  }

  return listWorkspaceCatalogRecords({ statuses: ['active', 'hidden'] }).map(toKnownWorkspace);
}

export function ensureCEOWorkspaceRegistered(): KnownWorkspace {
  return registerWorkspace({
    workspace: getCEOWorkspacePath(),
    sourceKind: 'ceo-bootstrap',
    workspaceKind: 'folder',
  });
}

export function listKnownWorkspaces(): KnownWorkspace[] {
  syncWorkspaceCatalogFromAntigravityRecent();
  ensureCEOWorkspaceRegistered();
  return listWorkspaceCatalogRecords({ statuses: ['active', 'hidden'] }).map(toKnownWorkspace);
}

export function getKnownWorkspace(input: string): KnownWorkspace | null {
  const normalized = normalizeWorkspaceIdentity(input);
  const existing = getWorkspaceCatalogRecordByUri(normalized.uri);
  if (existing) {
    return toKnownWorkspace(existing);
  }

  listKnownWorkspaces();
  const synced = getWorkspaceCatalogRecordByUri(normalized.uri);
  return synced ? toKnownWorkspace(synced) : null;
}

export function isKnownWorkspace(input: string): boolean {
  return Boolean(getKnownWorkspace(input));
}

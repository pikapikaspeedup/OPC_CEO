import fs from 'fs';
import path from 'path';

import {
  appendDepartmentMemory,
  initDepartmentMemory,
  readDepartmentMemory,
  readOrganizationMemory,
  type MemoryCategory,
} from '@/lib/agents/department-memory';
import { syncRulesToAllIDEs, syncRulesToIDE, type IDETarget } from '@/lib/agents/department-sync';
import {
  getDepartmentBoundWorkspaceUris,
  getDepartmentGroupKey,
  normalizeDepartmentConfig,
} from '@/lib/department-config';
import { getJournalEntriesForDate, getProjectsByWorkspace, templateSummary } from '@/lib/agents/digest-helpers';
import { getQuotaSummary } from '@/lib/approval/token-quota';
import { listKnowledgeAssets } from '@/lib/knowledge';
import {
  listDeliverableRecordsByProject,
  listProjectRecords,
  listRunRecordsByFilter,
} from '@/lib/storage/gateway-db';
import { getKnownWorkspace, listKnownWorkspaces } from '@/lib/workspace-catalog';
import type {
  ArtifactRefFE,
  Deliverable,
  DepartmentConfig,
  DepartmentContentResponse,
  DepartmentFileTreeNode,
  DepartmentMarkdownFile,
  DepartmentOutputItem,
  DepartmentOutputTreeNode,
  DepartmentDirectoryEntry,
  DepartmentRule,
  DepartmentRuleSource,
} from '@/lib/types';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function resolveWorkspace(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get('workspace') || null;
}

type KnownWorkspace = NonNullable<ReturnType<typeof getKnownWorkspace>>;

function resolveKnownWorkspace(req: Request): KnownWorkspace | Response {
  const workspaceUri = resolveWorkspace(req);
  if (!workspaceUri) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }
  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) {
    return json({ error: 'Unknown workspace' }, { status: 403 });
  }
  return workspace;
}

function getDateRange(baseDate: string, period: string): string[] {
  const dates: string[] = [];
  const base = new Date(`${baseDate}T00:00:00Z`);
  const days = period === 'month' ? 30 : period === 'week' ? 7 : 1;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - i);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

const VALID_MEMORY_CATEGORIES: MemoryCategory[] = ['knowledge', 'decisions', 'patterns'];
const VALID_SYNC_TARGETS: IDETarget[] = ['antigravity', 'codex', 'claude-code', 'cursor'];
const DEPARTMENT_RULE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const RESERVED_DEPARTMENT_RULE_NAMES = new Set(['department-identity']);
const MAX_FILE_TREE_DEPTH = 5;
const MAX_FILE_TREE_ENTRIES = 500;
const MAX_MARKDOWN_BYTES = 512 * 1024;
const IGNORED_FILE_TREE_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'coverage',
  '.DS_Store',
]);

function validateDepartmentRuleName(name: string | null): string | Response {
  const trimmed = name?.trim() || '';
  if (!trimmed || !DEPARTMENT_RULE_NAME_RE.test(trimmed) || trimmed.length > 120) {
    return json({ error: 'Invalid rule name' }, { status: 400 });
  }
  if (RESERVED_DEPARTMENT_RULE_NAMES.has(trimmed)) {
    return json({ error: 'Reserved rule name' }, { status: 400 });
  }
  return trimmed;
}

function readDepartmentRuleFiles(
  workspacePath: string,
  dirName: '.department/rules' | '.agents/rules',
  source: DepartmentRuleSource,
): DepartmentRule[] {
  const dir = path.join(workspacePath, dirName);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((file): DepartmentRule | null => {
      const name = file.replace(/\.md$/i, '');
      if (RESERVED_DEPARTMENT_RULE_NAMES.has(name)) return null;
      if (!DEPARTMENT_RULE_NAME_RE.test(name) || name.length > 120) return null;
      const filePath = path.join(dir, file);
      return {
        name,
        content: fs.readFileSync(filePath, 'utf-8'),
        source,
        editable: source === 'department',
        path: filePath,
      };
    })
    .filter((rule): rule is DepartmentRule => Boolean(rule));
}

function listEffectiveDepartmentRules(workspacePath: string): DepartmentRule[] {
  const byName = new Map<string, DepartmentRule>();
  for (const rule of readDepartmentRuleFiles(workspacePath, '.department/rules', 'department')) {
    byName.set(rule.name, rule);
  }
  for (const rule of readDepartmentRuleFiles(workspacePath, '.agents/rules', 'legacy-agents')) {
    if (!byName.has(rule.name)) {
      byName.set(rule.name, rule);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function safeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '..')) return null;
  return normalized;
}

function resolveInsideWorkspace(workspacePath: string, relativePath: string): string | null {
  const safePath = safeRelativePath(relativePath);
  if (!safePath) return null;
  const fullPath = path.resolve(workspacePath, safePath);
  const workspaceRoot = path.resolve(workspacePath);
  if (fullPath !== workspaceRoot && !fullPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    return null;
  }
  return fullPath;
}

function toIsoFromStats(stats: fs.Stats): string {
  return stats.mtime.toISOString();
}

function shouldShowFileTreeEntry(name: string): boolean {
  if (IGNORED_FILE_TREE_NAMES.has(name)) return false;
  if (name.endsWith('.log') || name.endsWith('.sqlite') || name.endsWith('.db')) return false;
  return true;
}

function buildFileTree(
  workspacePath: string,
  relativeRoot: string,
  rootLabel: string,
  state: { count: number },
  depth = 0,
): DepartmentFileTreeNode | null {
  const fullPath = resolveInsideWorkspace(workspacePath, relativeRoot);
  if (!fullPath || !fs.existsSync(fullPath)) return null;

  const stats = fs.statSync(fullPath);
  const name = relativeRoot ? path.basename(relativeRoot) : path.basename(workspacePath);
  const node: DepartmentFileTreeNode = {
    id: relativeRoot || '.',
    name,
    path: relativeRoot || '.',
    type: stats.isDirectory() ? 'directory' : 'file',
    size: stats.isFile() ? stats.size : undefined,
    modifiedAt: toIsoFromStats(stats),
    rootLabel,
  };

  state.count += 1;
  if (!stats.isDirectory() || depth >= MAX_FILE_TREE_DEPTH || state.count >= MAX_FILE_TREE_ENTRIES) {
    return node;
  }

  const children: DepartmentFileTreeNode[] = [];
  const entries = fs.readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => shouldShowFileTreeEntry(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

  for (const entry of entries) {
    if (state.count >= MAX_FILE_TREE_ENTRIES) break;
    const childRelativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const child = buildFileTree(workspacePath, childRelativePath, rootLabel, state, depth + 1);
    if (child) children.push(child);
  }

  node.children = children;
  return node;
}

function buildDepartmentFileTrees(workspacePath: string, config: DepartmentConfig | null): DepartmentFileTreeNode[] {
  const roots = new Map<string, string>();
  roots.set('', 'Workspace');
  roots.set('.department/outputs', 'Outputs');
  roots.set('.department/memory', 'Memory');
  roots.set('.department/rules', 'Rules');
  roots.set('.agents/rules', 'Legacy Rules');

  for (const documentPath of config?.executionPolicy?.contextDocumentPaths ?? []) {
    const safePath = safeRelativePath(documentPath);
    if (safePath) roots.set(safePath, 'Context');
  }

  const state = { count: 0 };
  const nodes: DepartmentFileTreeNode[] = [];
  for (const [relativePath, label] of roots.entries()) {
    const node = buildFileTree(workspacePath, relativePath, label, state);
    if (node) nodes.push(node);
  }
  return nodes;
}

function isReadableMarkdownPath(relativePath: string): boolean {
  return /\.(md|markdown|txt)$/i.test(relativePath);
}

function readMarkdownFile(workspacePath: string, relativePath: string): DepartmentMarkdownFile | undefined {
  const fullPath = resolveInsideWorkspace(workspacePath, relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) return undefined;
  const stats = fs.statSync(fullPath);
  if (!stats.isFile() || stats.size > MAX_MARKDOWN_BYTES || !isReadableMarkdownPath(relativePath)) return undefined;

  return {
    path: safeRelativePath(relativePath) || relativePath,
    name: path.basename(relativePath),
    content: fs.readFileSync(fullPath, 'utf-8'),
    size: stats.size,
    modifiedAt: toIsoFromStats(stats),
  };
}

function findFirstMarkdownNode(nodes: DepartmentFileTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file' && isReadableMarkdownPath(node.path)) return node.path;
    const child = node.children ? findFirstMarkdownNode(node.children) : null;
    if (child) return child;
  }
  return null;
}

function taskKeyFromPath(artifactPath: string | undefined, fallback: string): string {
  const cleaned = safeRelativePath(artifactPath || '') || '';
  const outputMatch = cleaned.match(/(?:^|\/)\.department\/outputs\/([^/]+)/);
  if (outputMatch?.[1]) return outputMatch[1];
  if (cleaned.startsWith('tasks/')) return cleaned.split('/')[1] || fallback;
  return fallback;
}

function taskTitleFromKey(taskKey: string): string {
  return taskKey
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || '未归档任务';
}

function normalizeOutputStatus(value: unknown): DepartmentOutputItem['status'] {
  if (value === 'needs-review' || value === 'archived' || value === 'active') return value;
  return 'active';
}

function normalizeAudience(value: unknown): DepartmentOutputItem['audience'] {
  if (value === 'ceo' || value === 'agent' || value === 'department') return value;
  return 'department';
}

function buildRunArtifactOutputItem(input: {
  runId: string;
  projectId?: string;
  createdAt: string;
  finishedAt?: string;
  taskId?: string;
  summary?: string;
  artifact: ArtifactRefFE;
}): DepartmentOutputItem {
  const metadata = input.artifact.metadata || {};
  const taskKey = String(metadata.taskKey || input.taskId || taskKeyFromPath(input.artifact.path, input.projectId || 'run-results'));
  return {
    id: `run:${input.runId}:${input.artifact.path}`,
    title: input.artifact.title || path.basename(input.artifact.path),
    kind: input.artifact.kind || input.artifact.format || 'artifact',
    taskKey,
    taskTitle: String(metadata.taskTitle || taskTitleFromKey(taskKey)),
    audience: normalizeAudience(metadata.audience),
    status: normalizeOutputStatus(metadata.status),
    createdAt: input.finishedAt || input.createdAt,
    updatedAt: input.finishedAt || input.createdAt,
    summary: input.summary,
    markdownPath: input.artifact.format === 'md' || /\.md$/i.test(input.artifact.path) ? input.artifact.path : undefined,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    source: {
      type: 'run-artifact',
      runId: input.runId,
      projectId: input.projectId,
      artifactPath: input.artifact.path,
    },
  };
}

function buildDeliverableOutputItem(deliverable: Deliverable & { sourceRunId?: string }): DepartmentOutputItem {
  const taskKey = taskKeyFromPath(deliverable.artifactPath, deliverable.projectId);
  return {
    id: `deliverable:${deliverable.id}`,
    title: deliverable.title,
    kind: deliverable.type,
    taskKey,
    taskTitle: taskTitleFromKey(taskKey),
    audience: 'department',
    status: deliverable.quality.reviewDecision === 'revise' ? 'needs-review' : 'active',
    createdAt: deliverable.createdAt,
    updatedAt: deliverable.quality.reviewedAt || deliverable.createdAt,
    markdownPath: deliverable.artifactPath && /\.md$/i.test(deliverable.artifactPath) ? deliverable.artifactPath : undefined,
    source: {
      type: 'project-deliverable',
      runId: deliverable.sourceRunId,
      projectId: deliverable.projectId,
      artifactPath: deliverable.artifactPath,
    },
  };
}

function buildKnowledgeOutputItems(workspaceUri: string): DepartmentOutputItem[] {
  return listKnowledgeAssets({ workspaceUri, scope: 'department' })
    .filter((asset) => {
      const tags = asset.tags || [];
      return tags.includes('department-output') || tags.some((tag) => tag.startsWith('task:')) || tags.includes('audience:ceo');
    })
    .map((asset) => {
      const taskTag = (asset.tags || []).find((tag) => tag.startsWith('task:'));
      const taskKey = taskTag ? taskTag.slice('task:'.length) : taskKeyFromPath(asset.source.artifactPath, 'knowledge');
      return {
        id: `knowledge:${asset.id}`,
        title: asset.title,
        kind: asset.category,
        taskKey,
        taskTitle: taskTitleFromKey(taskKey),
        audience: (asset.tags || []).includes('audience:ceo') ? 'ceo' : 'department',
        status: asset.status === 'proposal' || asset.status === 'conflicted' ? 'needs-review' : asset.status === 'stale' ? 'archived' : 'active',
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        summary: asset.content.replace(/\s+/g, ' ').slice(0, 220),
        markdownPath: asset.source.artifactPath,
        tags: asset.tags || [],
        source: {
          type: 'knowledge',
          runId: asset.source.runId,
          knowledgeId: asset.id,
          artifactPath: asset.source.artifactPath,
        },
      } satisfies DepartmentOutputItem;
    });
}

function readOutputIndexItems(workspacePath: string): DepartmentOutputItem[] {
  const indexPath = path.join(workspacePath, '.department', 'outputs', 'index.json');
  if (!fs.existsSync(indexPath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as { items?: unknown[] };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map((item): DepartmentOutputItem | null => {
        if (!item || typeof item !== 'object') return null;
        const candidate = item as Partial<DepartmentOutputItem>;
        if (!candidate.id || !candidate.title || !candidate.taskKey || !candidate.createdAt || !candidate.source) return null;
        return {
          id: candidate.id,
          title: candidate.title,
          kind: candidate.kind || 'brief',
          taskKey: candidate.taskKey,
          taskTitle: candidate.taskTitle || taskTitleFromKey(candidate.taskKey),
          audience: normalizeAudience(candidate.audience),
          status: normalizeOutputStatus(candidate.status),
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt || candidate.createdAt,
          summary: candidate.summary,
          markdownPath: candidate.markdownPath,
          tags: candidate.tags || [],
          source: candidate.source,
        };
      })
      .filter((item): item is DepartmentOutputItem => Boolean(item));
  } catch {
    return [];
  }
}

function scanOutputMarkdownFiles(workspacePath: string): DepartmentOutputItem[] {
  const outputRoot = path.join(workspacePath, '.department', 'outputs');
  if (!fs.existsSync(outputRoot)) return [];
  const items: DepartmentOutputItem[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!shouldShowFileTreeEntry(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
      const stats = fs.statSync(fullPath);
      const taskKey = taskKeyFromPath(relativePath, 'outputs');
      items.push({
        id: `file:${relativePath}`,
        title: path.basename(entry.name, path.extname(entry.name)),
        kind: 'brief',
        taskKey,
        taskTitle: taskTitleFromKey(taskKey),
        audience: 'department',
        status: 'active',
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        markdownPath: relativePath,
        source: {
          type: 'file',
          artifactPath: relativePath,
        },
      });
    }
  }

  walk(outputRoot);
  return items;
}

function buildDepartmentOutputItems(workspaceUri: string, workspacePath: string): DepartmentOutputItem[] {
  const items = new Map<string, DepartmentOutputItem>();

  for (const run of listRunRecordsByFilter({ workspace: workspaceUri }, { limit: 120, offset: 0 })) {
    for (const artifact of run.resultEnvelope?.outputArtifacts || []) {
      const item = buildRunArtifactOutputItem({
        runId: run.runId,
        projectId: run.projectId,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        taskId: run.resultEnvelope?.taskId || run.taskEnvelope?.taskId,
        summary: run.resultEnvelope?.summary || run.result?.summary,
        artifact: artifact as ArtifactRefFE,
      });
      items.set(item.id, item);
    }
  }

  for (const project of listProjectRecords().filter((entry) => entry.workspace === workspaceUri)) {
    for (const deliverable of listDeliverableRecordsByProject(project.projectId)) {
      const item = buildDeliverableOutputItem(deliverable);
      items.set(item.id, item);
    }
  }

  for (const item of buildKnowledgeOutputItems(workspaceUri)) {
    items.set(item.id, item);
  }
  for (const item of scanOutputMarkdownFiles(workspacePath)) {
    if (![...items.values()].some((existing) => existing.markdownPath && existing.markdownPath === item.markdownPath)) {
      items.set(item.id, item);
    }
  }
  for (const item of readOutputIndexItems(workspacePath)) {
    items.set(item.id, item);
  }

  return [...items.values()].sort((left, right) =>
    new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime(),
  );
}

function groupOutputItems(items: DepartmentOutputItem[]): DepartmentOutputTreeNode[] {
  const byTask = new Map<string, DepartmentOutputItem[]>();
  for (const item of items) {
    const list = byTask.get(item.taskKey) || [];
    list.push(item);
    byTask.set(item.taskKey, list);
  }

  return [...byTask.entries()]
    .sort((left, right) => {
      const leftTime = Math.max(...left[1].map((item) => new Date(item.updatedAt || item.createdAt).getTime()));
      const rightTime = Math.max(...right[1].map((item) => new Date(item.updatedAt || item.createdAt).getTime()));
      return rightTime - leftTime;
    })
    .map(([taskKey, taskItems]) => {
      const groupByStatus = new Map<string, DepartmentOutputItem[]>();
      for (const item of taskItems) {
        const label = item.status === 'needs-review' ? '待复核' : item.audience === 'ceo' ? 'CEO 摘要' : '产出物';
        const list = groupByStatus.get(label) || [];
        list.push(item);
        groupByStatus.set(label, list);
      }
      const children: DepartmentOutputTreeNode[] = [...groupByStatus.entries()].map(([label, groupedItems]) => ({
        id: `${taskKey}:${label}`,
        name: label,
        type: 'group',
        count: groupedItems.length,
        children: groupedItems.map((item) => ({
          id: item.id,
          name: item.title,
          type: 'item',
          output: item,
        })),
      }));
      return {
        id: taskKey,
        name: taskItems[0]?.taskTitle || taskTitleFromKey(taskKey),
        type: 'group',
        count: taskItems.length,
        children,
      };
    });
}

function loadConfiguredDepartmentForWorkspace(workspace: KnownWorkspace): DepartmentConfig | null {
  const configPath = path.join(workspace.path, '.department', 'config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DepartmentConfig;
  return normalizeDepartmentConfig(parsed, workspace.uri, workspace.name);
}

export async function handleDepartmentsListGet(): Promise<Response> {
  const entries = new Map<string, DepartmentDirectoryEntry>();

  for (const workspace of listKnownWorkspaces()) {
    try {
      const config = loadConfiguredDepartmentForWorkspace(workspace);
      if (!config) continue;

      const primaryWorkspaceUri = getDepartmentGroupKey(config, workspace.uri, workspace.name);
      const entryKey = config.departmentId?.trim() || primaryWorkspaceUri;
      if (entries.has(entryKey)) continue;

      entries.set(entryKey, {
        primaryWorkspaceUri,
        workspaceName: workspace.name,
        config,
      });
    } catch {
      // Skip malformed configs in the aggregated listing; point lookup still returns 422.
    }
  }

  return json(
    [...entries.values()].sort((left, right) => left.config.name.localeCompare(right.config.name)),
  );
}

export async function handleDepartmentsGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const configPath = path.join(workspace.path, '.department', 'config.json');
  if (!fs.existsSync(configPath)) {
    return json(normalizeDepartmentConfig({
      name: path.basename(workspace.path),
      type: 'build',
      skills: [],
      okr: null,
    }, workspace.uri, workspace.name));
  }

  try {
    return json(loadConfiguredDepartmentForWorkspace(workspace));
  } catch {
    return json({ error: 'Invalid .department/config.json format' }, { status: 422 });
  }
}

export async function handleDepartmentsContentGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  let config: DepartmentConfig | null = null;
  try {
    config = loadConfiguredDepartmentForWorkspace(workspace);
  } catch {
    config = null;
  }

  const url = new URL(req.url);
  const selectedPath = url.searchParams.get('path');
  const fileTree = buildDepartmentFileTrees(workspace.path, config);
  const outputTree = groupOutputItems(buildDepartmentOutputItems(workspace.uri, workspace.path));
  const fallbackMarkdownPath = selectedPath || findFirstMarkdownNode(fileTree);
  const selectedFile = fallbackMarkdownPath
    ? readMarkdownFile(workspace.path, fallbackMarkdownPath)
    : undefined;

  const response: DepartmentContentResponse = {
    workspaceUri: workspace.uri,
    workspaceName: workspace.name,
    generatedAt: new Date().toISOString(),
    fileTree,
    outputTree,
    ...(selectedFile ? { selectedFile } : {}),
  };

  return json(response);
}

export async function handleDepartmentsPut(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const config = normalizeDepartmentConfig(await req.json(), workspace.uri, workspace.name);
  const workspaceTargets = getDepartmentBoundWorkspaceUris(config, workspace.uri, workspace.name)
    .map((workspaceUri) => {
      const targetWorkspace = workspaceUri === workspace.uri
        ? workspace
        : getKnownWorkspace(workspaceUri);
      return targetWorkspace ?? null;
    })
    .filter((entry): entry is KnownWorkspace => Boolean(entry));

  if (workspaceTargets.length === 0) {
    return json({ error: 'No writable workspaces resolved for department config' }, { status: 400 });
  }

  for (const target of workspaceTargets) {
    const dir = path.join(target.path, '.department');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }

  return json({ ok: true, syncPending: true });
}

export async function handleDepartmentsRulesGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  return json({
    workspace: workspace.uri,
    rules: listEffectiveDepartmentRules(workspace.path),
  });
}

export async function handleDepartmentsRulesPut(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const ruleName = validateDepartmentRuleName(url.searchParams.get('name'));
  if (ruleName instanceof Response) {
    return ruleName;
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return json({ error: 'content is required (string)' }, { status: 400 });
  }

  const rulesDir = path.join(workspace.path, '.department', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  const filePath = path.join(rulesDir, `${ruleName}.md`);
  fs.writeFileSync(filePath, body.content, 'utf-8');
  const rule: DepartmentRule = {
    name: ruleName,
    content: body.content,
    source: 'department',
    editable: true,
    path: filePath,
  };

  return json({
    ok: true,
    rule,
  });
}

export async function handleDepartmentsRulesDelete(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const ruleName = validateDepartmentRuleName(url.searchParams.get('name'));
  if (ruleName instanceof Response) {
    return ruleName;
  }

  const filePath = path.join(workspace.path, '.department', 'rules', `${ruleName}.md`);
  if (!fs.existsSync(filePath)) {
    const legacyPath = path.join(workspace.path, '.agents', 'rules', `${ruleName}.md`);
    if (fs.existsSync(legacyPath)) {
      return json({ error: 'Legacy rule is read-only. Create a department override before deleting.' }, { status: 409 });
    }
    return json({ error: 'Rule not found' }, { status: 404 });
  }

  fs.unlinkSync(filePath);
  return json({ ok: true, name: ruleName });
}

export async function handleDepartmentsDigestGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const workspaceUri = url.searchParams.get('workspace');
  if (!workspaceUri) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  const workspace = getKnownWorkspace(workspaceUri);
  if (!workspace) {
    return json({ error: 'Unknown workspace' }, { status: 403 });
  }

  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const period = url.searchParams.get('period') || 'day';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Invalid date format, expected YYYY-MM-DD' }, { status: 400 });
  }
  if (!['day', 'week', 'month'].includes(period)) {
    return json({ error: 'Invalid period, expected day|week|month' }, { status: 400 });
  }

  const projects = getProjectsByWorkspace(workspaceUri);
  const dateRange = getDateRange(date, period);
  const dateSet = new Set(dateRange);
  const entries = dateRange.flatMap((day) => getJournalEntriesForDate(workspaceUri, day));
  const matchesRange = (isoDate: string | undefined) => !!isoDate && dateSet.has(isoDate.slice(0, 10));

  const completed = projects
    .filter((project) => project.status === 'completed' && matchesRange(project.updatedAt))
    .map((project) => ({
      projectId: project.projectId,
      projectName: project.name,
      description: project.goal || '',
    }));

  const inProgress = projects
    .filter((project) => project.status === 'active')
    .map((project) => {
      const stages = project.pipelineState?.stages || [];
      const done = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
      return {
        projectId: project.projectId,
        projectName: project.name,
        description: project.goal || '',
        progress: stages.length > 0 ? `Stage ${done}/${stages.length}` : undefined,
      };
    });

  const blocked = projects
    .filter((project) => project.pipelineState?.stages.some((stage) => stage.status === 'blocked' || stage.status === 'failed'))
    .map((project) => {
      const failedStage = project.pipelineState?.stages.find((stage) => stage.status === 'blocked' || stage.status === 'failed');
      return {
        projectId: project.projectId,
        description: failedStage?.lastError || `${project.name} blocked`,
        since: failedStage?.startedAt || project.updatedAt || '',
      };
    });

  const periodLabel = period === 'month' ? '本月' : period === 'week' ? '本周' : '今日';
  const summary = period === 'day'
    ? templateSummary(
      completed.map((item) => ({ name: item.projectName })),
      inProgress.map((item) => ({ name: item.projectName })),
    )
    : `${periodLabel}${completed.length ? `完成 ${completed.length} 项任务` : ''}${inProgress.length ? `${completed.length ? '，' : ''}${inProgress.length} 项进行中` : ''}${blocked.length ? `${completed.length || inProgress.length ? '，' : ''}${blocked.length} 项阻塞` : ''}` || `${periodLabel}暂无活动`;

  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of entries) {
    const details = entry.details as Record<string, unknown> | undefined;
    if (details?.inputTokens) {
      inputTokens += Number(details.inputTokens) || 0;
    }
    if (details?.outputTokens) {
      outputTokens += Number(details.outputTokens) || 0;
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const estimatedCostUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

  return json({
    workspaceUri,
    departmentName: path.basename(workspace.path),
    date,
    period,
    summary,
    tasksCompleted: completed,
    tasksInProgress: inProgress,
    blockers: blocked,
    tokenUsage: totalTokens > 0 ? {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
    } : undefined,
  });
}

export async function handleDepartmentsMemoryGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') || 'department';

  if (scope === 'organization') {
    return json({ scope: 'organization', content: readOrganizationMemory() });
  }

  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  return json({
    scope: 'department',
    workspace: workspace.uri,
    memory: readDepartmentMemory(workspace.path),
  });
}

export async function handleDepartmentsMemoryPost(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  if (action === 'init') {
    initDepartmentMemory(workspace.path);
    return json({ ok: true, action: 'initialized' });
  }

  const category = url.searchParams.get('category') as MemoryCategory | null;
  if (!category || !VALID_MEMORY_CATEGORIES.includes(category)) {
    return json({ error: `Invalid category. Valid: ${VALID_MEMORY_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const body = await req.json();
  if (!body.content || typeof body.content !== 'string') {
    return json({ error: 'Missing content' }, { status: 400 });
  }

  appendDepartmentMemory(workspace.path, category, {
    timestamp: new Date().toISOString(),
    source: body.source || 'manual',
    content: body.content,
  });

  return json({ ok: true, category });
}

export async function handleDepartmentsQuotaGet(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  return json({
    workspace: workspace.uri,
    quota: getQuotaSummary(workspace.path),
  });
}

export async function handleDepartmentsSyncPost(req: Request): Promise<Response> {
  const workspace = resolveKnownWorkspace(req);
  if (workspace instanceof Response) {
    return workspace;
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('target') || 'all';

  if (target === 'all') {
    const { results } = syncRulesToAllIDEs(workspace.path);
    return json({ ok: true, results });
  }

  if (!VALID_SYNC_TARGETS.includes(target as IDETarget)) {
    return json({ error: `Invalid target: ${target}. Valid: ${VALID_SYNC_TARGETS.join(', ')}` }, { status: 400 });
  }

  const { synced } = syncRulesToIDE(workspace.path, target as IDETarget);
  return json({ ok: true, target, synced });
}

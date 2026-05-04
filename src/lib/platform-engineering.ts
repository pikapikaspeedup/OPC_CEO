import fs from 'fs';
import path from 'path';

import { initDepartmentMemoryV2 } from './agents/department-memory-bridge';
import { GATEWAY_HOME } from './agents/gateway-home';
import { normalizeDepartmentConfig } from './department-config';
import type { ProjectGovernance } from './agents/project-types';
import type { DepartmentConfig } from './types';

export const PLATFORM_ENGINEERING_DEPARTMENT_ID = 'department:platform-engineering';
export const PLATFORM_ENGINEERING_WORKSPACE_ALIAS = 'platform-engineering';
export const PLATFORM_ENGINEERING_WORKSPACE_NAME = '平台工程部';

function getRepoRoot(): string {
  return process.cwd();
}

export function getPlatformEngineeringWorkspacePath(): string {
  return path.join(GATEWAY_HOME, 'system-workspaces', PLATFORM_ENGINEERING_WORKSPACE_ALIAS);
}

export function getPlatformEngineeringWorktreesPath(): string {
  return path.join(getPlatformEngineeringWorkspacePath(), 'worktrees');
}

export function getPlatformEngineeringEvidencePath(): string {
  return path.join(getPlatformEngineeringWorkspacePath(), 'evidence');
}

export function getPlatformEngineeringWorkspaceUri(): string {
  return `file://${getPlatformEngineeringWorkspacePath()}`;
}

export function isPlatformEngineeringWorkspaceUri(workspaceUri?: string | null): boolean {
  if (!workspaceUri) return false;
  return workspaceUri === getPlatformEngineeringWorkspaceUri();
}

export function defaultPlatformEngineeringProjectGovernance(): ProjectGovernance {
  return {
    platformEngineering: {
      observe: true,
      allowProposal: true,
      departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
      source: 'default',
      updatedAt: new Date().toISOString(),
    },
  };
}

function buildContextDocumentPaths(): string[] {
  const repoRoot = getRepoRoot();
  return [
    path.join(repoRoot, 'ARCHITECTURE.md'),
    path.join(repoRoot, 'docs/design/self-evolution/README.md'),
    path.join(repoRoot, 'docs/design/self-evolution/trial-run-action-plan-2026-04-30.md'),
  ];
}

export function buildDefaultPlatformEngineeringDepartmentConfig(): DepartmentConfig {
  const workspaceUri = getPlatformEngineeringWorkspaceUri();
  return normalizeDepartmentConfig({
    departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
    name: PLATFORM_ENGINEERING_WORKSPACE_NAME,
    type: 'build',
    description: '负责主软件核心、自进化闭环、系统改进 proposal、受控开发与准出证据。',
    skills: [
      {
        skillId: 'guarded-core-development',
        name: '主软件受控开发',
        category: 'delivery',
      },
      {
        skillId: 'system-improvement-proposal',
        name: '系统改进提案',
        category: 'platform-evolution',
      },
    ],
    templateIds: [
      'development-template-1',
      'coding-basic-template',
    ],
    workspaceBindings: [
      {
        workspaceUri,
        alias: PLATFORM_ENGINEERING_WORKSPACE_ALIAS,
        role: 'primary',
        writeAccess: true,
      },
    ],
    executionPolicy: {
      defaultWorkspaceUri: workspaceUri,
      contextDocumentPaths: buildContextDocumentPaths(),
    },
  }, workspaceUri, PLATFORM_ENGINEERING_WORKSPACE_NAME);
}

function writeFileIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function ensurePlatformEngineeringRules(workspacePath: string): void {
  writeFileIfMissing(
    path.join(workspacePath, '.department', 'rules', 'guarded-core-dev.md'),
    [
      '# Platform Engineering Rules',
      '',
      '- Admission and exit are human-gated.',
      '- Use existing Department / Project / Company Kernel / Approval mechanisms.',
      '- Protected core changes require explicit test evidence and rollback steps.',
      '- Do not merge or restart automatically.',
      '',
    ].join('\n'),
  );
}

function ensurePlatformEngineeringMemory(workspacePath: string): void {
  initDepartmentMemoryV2(workspacePath);

  writeFileIfMissing(
    path.join(workspacePath, '.department', 'memory', 'shared', 'platform-engineering-decisions.md'),
    [
      '# Platform Engineering Decisions',
      '',
      '- Human review happens only at admission and exit.',
      '- Core software changes must produce an evidence bundle before merge or restart.',
      '- Reuse existing Project, Approval, Budget, Scheduler, and Company Kernel mechanisms.',
      '',
      '---',
      '',
    ].join('\n'),
  );

  writeFileIfMissing(
    path.join(workspacePath, '.department', 'memory', 'shared', 'platform-engineering-patterns.md'),
    [
      '# Platform Engineering Patterns',
      '',
      '- Convert repeated failures into structured signals before proposing code changes.',
      '- Keep edits in isolated worktrees with explicit rollback plans.',
      '- Treat User Story gaps as backlog signals, not as implicit implementation permission.',
      '',
      '---',
      '',
    ].join('\n'),
  );

  writeFileIfMissing(
    path.join(workspacePath, '.department', 'memory', 'codex', 'platform-engineering.md'),
    [
      '# Codex Provider Notes',
      '',
      '- Prefer concise implementation loops with explicit evidence.',
      '- Read structured knowledge assets before changing protected core modules.',
      '',
      '---',
      '',
    ].join('\n'),
  );

  writeFileIfMissing(
    path.join(workspacePath, '.department', 'memory', 'claude-engine', 'platform-engineering.md'),
    [
      '# Claude Engine Provider Notes',
      '',
      '- Use the Department runtime contract and preserve artifact evidence for guarded changes.',
      '- Avoid side effects outside the declared write roots.',
      '',
      '---',
      '',
    ].join('\n'),
  );
}

export function ensurePlatformEngineeringWorkspaceSkeleton(): {
  workspacePath: string;
  workspaceUri: string;
  config: DepartmentConfig;
} {
  const workspacePath = getPlatformEngineeringWorkspacePath();
  const workspaceUri = getPlatformEngineeringWorkspaceUri();
  fs.mkdirSync(workspacePath, { recursive: true });

  const configPath = path.join(workspacePath, '.department', 'config.json');
  const seeded = buildDefaultPlatformEngineeringDepartmentConfig();

  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(seeded, null, 2), 'utf-8');
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DepartmentConfig;
      const merged = normalizeDepartmentConfig({
        ...seeded,
        ...existing,
        skills: existing.skills?.length ? existing.skills : seeded.skills,
        templateIds: existing.templateIds?.length ? existing.templateIds : seeded.templateIds,
        workspaceBindings: existing.workspaceBindings?.length ? existing.workspaceBindings : seeded.workspaceBindings,
        executionPolicy: {
          ...seeded.executionPolicy,
          ...(existing.executionPolicy || {}),
          contextDocumentPaths: existing.executionPolicy?.contextDocumentPaths?.length
            ? existing.executionPolicy.contextDocumentPaths
            : seeded.executionPolicy?.contextDocumentPaths,
        },
      }, workspaceUri, PLATFORM_ENGINEERING_WORKSPACE_NAME);
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
    } catch {
      fs.writeFileSync(configPath, JSON.stringify(seeded, null, 2), 'utf-8');
    }
  }

  ensurePlatformEngineeringRules(workspacePath);
  ensurePlatformEngineeringMemory(workspacePath);

  return {
    workspacePath,
    workspaceUri,
    config: seeded,
  };
}

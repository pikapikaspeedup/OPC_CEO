import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';

import { appendRunHistoryEntry, readRunHistory } from '../src/lib/agents/run-history';
import { scanArtifactManifest, writeEnvelopeFile } from '../src/lib/agents/run-artifacts';
import { PROJECTS_FILE, RUNS_FILE, CONVS_FILE, SCHEDULED_JOBS_FILE, GATEWAY_HOME } from '../src/lib/agents/gateway-home';
import type { ProjectDefinition } from '../src/lib/agents/project-types';
import type { AgentRunState, ResultEnvelope } from '../src/lib/agents/group-types';
import type { ScheduledJob } from '../src/lib/agents/scheduler-types';
import {
  getGatewayDbPath,
  listConversationRecords,
  listDeliverableRecordsByProject,
  listProjectRecords,
  listRunRecords,
  listScheduledJobRecords,
  type LocalConversationRecord,
  syncRunArtifactsToDeliverables,
  upsertConversationRecord,
  upsertProjectRecord,
  upsertRunRecord,
  upsertScheduledJobRecord,
} from '../src/lib/storage/gateway-db';

function readJsonFile<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T[];
}

function timestampDirName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureBackup(files: string[]): string {
  const backupDir = path.join(GATEWAY_HOME, 'legacy-backup', timestampDirName());
  mkdirSync(backupDir, { recursive: true });
  for (const file of files) {
    if (!existsSync(file)) continue;
    cpSync(file, path.join(backupDir, path.basename(file)));
  }
  return backupDir;
}

function seedRunHistory(run: AgentRunState): void {
  const existingEntries = readRunHistory(run.runId);
  const hasEvent = (eventType: string) => existingEntries.some((entry) => entry.eventType === eventType);

  if (run.prompt && !hasEvent('conversation.message.user')) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'conversation.message.user',
      details: {
        content: run.prompt,
      },
    });
  }

  if (!hasEvent('migration.imported')) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider: run.provider,
      sessionHandle: run.sessionProvenance?.handle,
      eventType: 'migration.imported',
      details: {
        status: run.status,
        projectId: run.projectId,
        stageId: run.stageId,
        executorKind: run.executorKind,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
    });
  }

  if (run.result?.summary && !hasEvent('result.discovered')) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider: run.provider,
      eventType: 'result.discovered',
      details: {
        status: run.result.status,
        summary: run.result.summary,
      },
    });
  }

  if (run.workspace && run.artifactDir && !hasEvent('conversation.message.assistant')) {
    const workspacePath = run.workspace.replace(/^file:\/\//, '');
    const artifactAbsDir = path.join(workspacePath, run.artifactDir);
    if (existsSync(artifactAbsDir)) {
      const draftPath = readdirSync(artifactAbsDir)
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => path.join(artifactAbsDir, entry))
        .find(Boolean);
      if (draftPath) {
        const draftContent = readFileSync(draftPath, 'utf-8');
        if (draftContent.trim()) {
          appendRunHistoryEntry({
            runId: run.runId,
            provider: run.provider,
            sessionHandle: run.sessionProvenance?.handle,
            eventType: 'conversation.message.assistant',
            details: {
              content: draftContent,
              importedFromArtifact: path.relative(workspacePath, draftPath),
            },
          });
        }
      }
    }
  }

  if (run.resultEnvelope?.outputArtifacts?.length && !hasEvent('artifact.discovered')) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider: run.provider,
      eventType: 'artifact.discovered',
      details: {
        count: run.resultEnvelope.outputArtifacts.length,
        items: run.resultEnvelope.outputArtifacts.map((artifact) => ({
          title: artifact.title,
          kind: artifact.kind,
          path: artifact.path,
        })),
      },
    });
  }

  if ((run.verificationPassed !== undefined || run.reportedEventCount !== undefined || run.reportedEventDate) && !hasEvent('verification.discovered')) {
    appendRunHistoryEntry({
      runId: run.runId,
      provider: run.provider,
      eventType: 'verification.discovered',
      details: {
        verificationPassed: run.verificationPassed,
        reportedEventDate: run.reportedEventDate,
        reportedEventCount: run.reportedEventCount,
        reportApiResponse: run.reportApiResponse,
      },
    });
  }
}

function repairRunArtifacts(run: AgentRunState): AgentRunState {
  if (!run.workspace || !run.artifactDir) return run;
  const workspacePath = run.workspace.replace(/^file:\/\//, '');
  const artifactAbsDir = path.join(workspacePath, run.artifactDir);
  if (!existsSync(artifactAbsDir)) return run;

  const existingArtifacts = run.resultEnvelope?.outputArtifacts || [];
  if (existingArtifacts.length > 0) return run;

  const manifest = scanArtifactManifest(run.runId, run.templateId, artifactAbsDir, run.executionTarget);
  if (manifest.items.length === 0) return run;

  writeEnvelopeFile(artifactAbsDir, 'artifacts.manifest.json', manifest);

  const resultEnvelope: ResultEnvelope = run.resultEnvelope
    ? {
        ...run.resultEnvelope,
        outputArtifacts: manifest.items,
      }
    : {
        templateId: run.templateId,
        executionTarget: run.executionTarget,
        runId: run.runId,
        status: run.status,
        summary: run.result?.summary || 'Imported run',
        outputArtifacts: manifest.items,
        risks: run.result?.blockers || [],
        nextAction: run.status === 'completed' ? 'Imported run completed' : undefined,
      };

  writeEnvelopeFile(artifactAbsDir, 'result-envelope.json', resultEnvelope);

  return {
    ...run,
    resultEnvelope,
    artifactManifestPath: `${run.artifactDir}artifacts.manifest.json`,
  };
}

function main(): void {
  const legacyFiles = [PROJECTS_FILE, RUNS_FILE, CONVS_FILE, SCHEDULED_JOBS_FILE];
  const backupDir = ensureBackup(legacyFiles);

  const projects = readJsonFile<ProjectDefinition>(PROJECTS_FILE);
  const runs = readJsonFile<AgentRunState>(RUNS_FILE);
  const conversations = readJsonFile<LocalConversationRecord>(CONVS_FILE);
  const jobs = readJsonFile<ScheduledJob>(SCHEDULED_JOBS_FILE);

  for (const project of projects) {
    upsertProjectRecord(project);
  }
  for (const run of runs) {
    const repairedRun = repairRunArtifacts(run);
    upsertRunRecord(repairedRun);
    seedRunHistory(repairedRun);
    syncRunArtifactsToDeliverables(repairedRun);
  }
  for (const conversation of conversations) {
    upsertConversationRecord(conversation);
  }
  for (const job of jobs) {
    upsertScheduledJobRecord(job);
  }

  const summary = {
    backupDir,
    dbPath: getGatewayDbPath(),
    imported: {
      projects: projects.length,
      runs: runs.length,
      conversations: conversations.length,
      scheduledJobs: jobs.length,
    },
    current: {
      projects: listProjectRecords().length,
      runs: listRunRecords().length,
      conversations: listConversationRecords().length,
      scheduledJobs: listScheduledJobRecords().length,
      deliverables: projects.reduce((sum, project) => sum + listDeliverableRecordsByProject(project.projectId).length, 0),
    },
  };

  const summaryPath = path.join(backupDir, 'migration-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify(summary, null, 2));
}

main();

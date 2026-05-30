import * as fs from 'fs';
import * as path from 'path';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';

import {
  getCanonicalSkill,
  getCanonicalWorkflowRuntimeConfig,
  getCanonicalWorkflowScriptsDir,
} from './canonical-assets';
import type { TaskResult } from './group-types';
import { STORY_TOP_CANDIDATE_ARTIFACT } from '../story-top-candidates';
import { ingestStoryTopCandidatesFromArtifact } from '../company-kernel/story-top-candidate-signals';

const execFile = promisify(execFileCallback);

type BigEventPayload = {
  eventDate: string;
  events: Array<{
    category: string;
    title: string;
    summary: string;
    importance?: number;
    sourceArticleIds?: number[];
    sourceUrls?: string[];
  }>;
  notes?: string;
  status?: 'skip';
  skipReason?: string;
  targetDate?: string;
  runMode?: 'first' | 'supplement' | string;
};

type BigEventVerification = {
  status?: 'success' | 'skip' | 'failed';
  targetDate?: string;
  runMode?: string;
  saved?: number;
  skipped?: number;
  reportResponse?: unknown;
  verifyResponse?: {
    data?: {
      events?: Array<{ title?: string; category?: string }>;
      total?: number;
    };
  };
  verificationPassed?: boolean;
  reportUrl?: string;
  verifyApiUrl?: string;
  message?: string;
};

export interface WorkflowRuntimeFinalizeOptions {
  workflowOutputText?: string;
}

type AiDigestPreparedContext = {
  status?: string;
  skipReason?: string | null;
  targetDate?: string;
  articleCount?: number;
  sourceArticleIds?: Array<string | number>;
  articles?: Array<{ title?: string; summary?: string; url?: string }>;
  window?: {
    start?: string;
    end?: string;
  };
};

type AiDigestOutput = {
  title?: string;
  summary?: string;
  contentHtml?: string;
  sourceArticleIds?: Array<string | number>;
};

type AiDigestVerification = {
  status?: string;
  reportUrl?: string;
  verifyApiUrl?: string;
  verifyPageUrl?: string | null;
  verifyPageStatus?: number | null;
  reportResponse?: unknown;
  verifyApiResponse?: {
    data?: {
      exists?: boolean;
      run?: {
        id?: number;
        digestDate?: string;
        title?: string;
      };
    };
  };
};

type WorkflowRuntimeManifest = {
  runtimeProfile?: string;
  runtimeSkill?: string;
  runtimeScriptsDir?: string;
};

type WorkflowRuntimeSupport = {
  skillName?: string;
  skillBaseDir?: string | null;
  scriptsDir?: string | null;
};

function getAsiaShanghaiDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function runPythonScript(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFile('python3', [scriptPath, ...args], {
    cwd,
    timeout: 120_000,
    maxBuffer: 10_000_000,
  });
}

function resolveWorkflowRuntimeManifest(resolvedWorkflowRef: string | undefined): WorkflowRuntimeManifest {
  if (!resolvedWorkflowRef) {
    return {};
  }
  return getCanonicalWorkflowRuntimeConfig(resolvedWorkflowRef) ?? {};
}

function resolveWorkflowRuntimeSupport(manifest: WorkflowRuntimeManifest): WorkflowRuntimeSupport {
  const skill = manifest.runtimeSkill ? getCanonicalSkill(manifest.runtimeSkill) : null;
  return {
    skillName: skill?.name,
    skillBaseDir: skill?.baseDir ?? null,
    scriptsDir: manifest.runtimeScriptsDir ? getCanonicalWorkflowScriptsDir(manifest.runtimeScriptsDir) : null,
  };
}

function resolveRuntimeScriptPath(runtime: WorkflowRuntimeSupport, scriptName: string): string | null {
  if (runtime.scriptsDir) {
    const workflowScript = path.join(runtime.scriptsDir, scriptName);
    if (fs.existsSync(workflowScript)) {
      return workflowScript;
    }
  }
  if (runtime.skillBaseDir) {
    const skillScript = path.join(runtime.skillBaseDir, 'scripts', scriptName);
    if (fs.existsSync(skillScript)) {
      return skillScript;
    }
  }
  return null;
}

function resolveDepartmentPrivatePath(workspacePath: string): string {
  return path.join(workspacePath, '.department', 'private.json');
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toRelativePath(workspacePath: string, absolutePath: string): string {
  return path.relative(workspacePath, absolutePath);
}

function summarizeBigEventVerification(verification: BigEventVerification): string {
  const titles = (verification.verifyResponse?.data?.events || [])
    .slice(0, 5)
    .map((event) => event.title)
    .filter(Boolean);
  const titleSummary = titles.length ? `事件示例：${titles.join('；')}` : '已完成写入并通过回读校验。';
  return `AI 大事件已上报成功：${verification.targetDate}，共 ${verification.saved || 0} 条。${titleSummary}`;
}

function summarizeAiDigestVerification(
  verification: AiDigestVerification,
  payload: AiDigestOutput,
  preparedContext: AiDigestPreparedContext | null,
): string {
  const targetDate = verification.verifyApiResponse?.data?.run?.digestDate
    || preparedContext?.targetDate
    || getAsiaShanghaiDateString();
  const title = verification.verifyApiResponse?.data?.run?.title || payload.title || '未命名日报';
  const articleCount = payload.sourceArticleIds?.length
    || preparedContext?.sourceArticleIds?.length
    || 0;
  return `AI 日报已上报成功：${targetDate}，标题《${title}》，来源文章 ${articleCount} 篇。`;
}

async function finalizeAiDigestRun(
  manifest: WorkflowRuntimeManifest,
  workspacePath: string,
  artifactAbsDir: string,
  result: TaskResult,
): Promise<TaskResult> {
  if (result.status !== 'completed') {
    return result;
  }

  const runtime = resolveWorkflowRuntimeSupport(manifest);
  const contextPath = path.join(artifactAbsDir, 'prepared-ai-digest-context.json');
  const digestOutputPath = path.join(artifactAbsDir, 'digest_output.json');
  const payloadPath = path.join(artifactAbsDir, 'daily-digest-report-payload.json');
  const verificationPath = path.join(artifactAbsDir, 'daily-digest-verification.json');
  const reportScript = resolveRuntimeScriptPath(runtime, 'report_digest.py');

  if (!reportScript) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, 'Missing runtime helper: report_digest.py'],
      summary: 'AI 日报 post-run 失败：缺少运行时脚本 report_digest.py。',
    };
  }

  let preparedContext: AiDigestPreparedContext | null = null;
  try {
    preparedContext = JSON.parse(fs.readFileSync(contextPath, 'utf-8')) as AiDigestPreparedContext;
  } catch {
    preparedContext = null;
  }

  if (preparedContext?.status === 'skip') {
    const skipReason = preparedContext.skipReason || '日报预处理要求跳过';
    return {
      ...result,
      status: 'blocked',
      blockers: [...result.blockers, skipReason],
      summary: `AI 日报未上报：${skipReason}`,
      reportedEventDate: preparedContext.targetDate,
      reportedEventCount: 0,
      verificationPassed: false,
    };
  }

  if (!fs.existsSync(digestOutputPath)) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, 'AI 日报输出文件缺失：digest_output.json'],
      summary: 'AI 日报 post-run 失败：未找到 digest_output.json。',
    };
  }

  let digestOutput: AiDigestOutput | null = null;
  try {
    digestOutput = JSON.parse(fs.readFileSync(digestOutputPath, 'utf-8')) as AiDigestOutput;
  } catch {
    digestOutput = null;
  }

  if (!digestOutput) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, 'AI 日报输出文件无法解析：digest_output.json'],
      summary: 'AI 日报 post-run 失败：digest_output.json 无法解析。',
    };
  }

  let verification: AiDigestVerification | null = null;
  try {
    const { stdout } = await runPythonScript(reportScript, [
      '--input', digestOutputPath,
      '--context', contextPath,
      '--payload-out', payloadPath,
      '--insecure',
    ], workspacePath);
    verification = JSON.parse(stdout.trim()) as AiDigestVerification;
    fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, `AI 日报上报失败：${message}`],
      summary: `AI 日报上报失败：${message}`,
      changedFiles: uniqStrings([
        ...result.changedFiles,
        fs.existsSync(payloadPath) ? toRelativePath(workspacePath, payloadPath) : '',
      ]),
      reportedEventDate: preparedContext?.targetDate,
      reportedEventCount: digestOutput.sourceArticleIds?.length || preparedContext?.sourceArticleIds?.length || 0,
      verificationPassed: false,
    };
  }

  const verificationPassed = Boolean(
    verification?.status === 'ok'
    && verification.verifyApiResponse?.data?.exists
    && (verification.verifyPageStatus === null || verification.verifyPageStatus === undefined || verification.verifyPageStatus < 400),
  );

  if (!verificationPassed) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, 'AI 日报回读验证失败'],
      summary: 'AI 日报回读验证失败。',
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, payloadPath),
        toRelativePath(workspacePath, verificationPath),
      ]),
      reportedEventDate: preparedContext?.targetDate,
      reportedEventCount: digestOutput.sourceArticleIds?.length || preparedContext?.sourceArticleIds?.length || 0,
      verificationPassed: false,
      reportApiResponse: verification?.reportUrl,
    };
  }

  return {
    ...result,
    status: 'completed',
    summary: summarizeAiDigestVerification(verification, digestOutput, preparedContext),
    blockers: [],
    changedFiles: uniqStrings([
      ...result.changedFiles,
      toRelativePath(workspacePath, digestOutputPath),
      toRelativePath(workspacePath, payloadPath),
      toRelativePath(workspacePath, verificationPath),
    ]),
    reportedEventDate: verification.verifyApiResponse?.data?.run?.digestDate || preparedContext?.targetDate,
    reportedEventCount: digestOutput.sourceArticleIds?.length || preparedContext?.sourceArticleIds?.length || 0,
    verificationPassed: true,
    reportApiResponse: verification.reportUrl,
  };
}

async function finalizeStoryTopCandidatesRun(
  workspacePath: string,
  artifactAbsDir: string,
  result: TaskResult,
  options?: WorkflowRuntimeFinalizeOptions,
): Promise<TaskResult> {
  if (result.status !== 'completed') {
    return result;
  }

  const artifactPath = path.join(artifactAbsDir, STORY_TOP_CANDIDATE_ARTIFACT);
  if (!fs.existsSync(artifactPath) && options?.workflowOutputText?.trim()) {
    const fencedJson = options.workflowOutputText.match(/```json\s*([\s\S]*?)```/i)?.[1]
      || options.workflowOutputText.match(/\[[\s\S]*\]/)?.[0];
    if (fencedJson) {
      try {
        JSON.parse(fencedJson);
        fs.writeFileSync(artifactPath, `${fencedJson.trim()}\n`, 'utf-8');
      } catch {
        // Leave missing-file handling to ingestion path below.
      }
    }
  }

  let ingested: { count: number } | null = null;
  try {
    ingested = ingestStoryTopCandidatesFromArtifact({
      workspacePath,
      workspaceUri: `file://${workspacePath}`,
      artifactAbsDir,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, `Top 3 候选写回失败：${message}`],
      summary: `Top 3 候选写回失败：${message}`,
    };
  }

  return {
    ...result,
    status: 'completed',
    summary: `平台工程候选改进 Top 3 已刷新，共 ${ingested.count} 条。`,
    blockers: [],
    changedFiles: uniqStrings([
      ...result.changedFiles,
      toRelativePath(workspacePath, path.join(artifactAbsDir, STORY_TOP_CANDIDATE_ARTIFACT)),
    ]),
  };
}

async function finalizeAiBigEventRun(
  manifest: WorkflowRuntimeManifest,
  workspacePath: string,
  artifactAbsDir: string,
  result: TaskResult,
): Promise<TaskResult> {
  const runtime = resolveWorkflowRuntimeSupport(manifest);
  const contextPath = path.join(artifactAbsDir, 'prepared-ai-bigevent-context.json');
  const rawDraftPath = path.join(artifactAbsDir, 'native-codex-ai-bigevent-draft.md');
  const payloadPath = path.join(artifactAbsDir, 'daily-events-report.json');
  const buildMetaPath = path.join(artifactAbsDir, 'daily-events-build.json');
  const verificationPath = path.join(artifactAbsDir, 'daily-events-verification.json');
  const buildScript = resolveRuntimeScriptPath(runtime, 'build_report.py');
  const reportScript = resolveRuntimeScriptPath(runtime, 'report_daily_events.py');
  const privateConfigPath = resolveDepartmentPrivatePath(workspacePath);

  if (!buildScript || !reportScript) {
    const missingHelpers = [
      !buildScript ? 'build_report.py' : null,
      !reportScript ? 'report_daily_events.py' : null,
    ].filter(Boolean);
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, `Missing runtime helpers: ${missingHelpers.join(', ')}`],
      summary: `AI 大事件 post-run 失败：缺少运行时脚本 ${missingHelpers.join(', ')}。`,
    };
  }

  fs.writeFileSync(rawDraftPath, result.summary, 'utf-8');

  try {
    await runPythonScript(buildScript, [
      '--context', contextPath,
      '--draft-file', rawDraftPath,
      '--out', payloadPath,
      '--result-out', buildMetaPath,
    ], workspacePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, `AI 大事件 payload 构建失败：${message}`],
      summary: `AI 大事件 payload 构建失败：${message}`,
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, rawDraftPath),
      ]),
    };
  }

  let payload: BigEventPayload | null = null;
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, 'utf-8')) as BigEventPayload;
  } catch {
    payload = null;
  }

  if (!payload) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, 'AI 大事件 payload 生成后无法解析。'],
      summary: 'AI 大事件 payload 生成后无法解析。',
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, rawDraftPath),
      ]),
    };
  }

  if (payload.status === 'skip') {
    return {
      ...result,
      status: 'blocked',
      blockers: [...result.blockers, payload.skipReason || '没有新的 AI 大事件可上报'],
      summary: `AI 大事件未上报：${payload.skipReason || '没有新的 AI 大事件可上报'}`,
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, rawDraftPath),
        toRelativePath(workspacePath, payloadPath),
        toRelativePath(workspacePath, buildMetaPath),
      ]),
      reportedEventDate: payload.targetDate,
      reportedEventCount: 0,
      verificationPassed: false,
    };
  }

  try {
    await runPythonScript(reportScript, [
      '--input', payloadPath,
      '--context', contextPath,
      '--out', verificationPath,
      '--token-file', privateConfigPath,
      '--insecure',
    ], workspacePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, `AI 大事件上报失败：${message}`],
      summary: `AI 大事件上报失败：${message}`,
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, rawDraftPath),
        toRelativePath(workspacePath, payloadPath),
        toRelativePath(workspacePath, buildMetaPath),
      ]),
      reportedEventDate: payload.eventDate,
      reportedEventCount: payload.events.length,
      verificationPassed: false,
    };
  }

  let verification: BigEventVerification | null = null;
  try {
    verification = JSON.parse(fs.readFileSync(verificationPath, 'utf-8')) as BigEventVerification;
  } catch {
    verification = null;
  }

  if (!verification?.verificationPassed) {
    return {
      ...result,
      status: 'failed',
      blockers: [...result.blockers, verification?.message || 'AI 大事件回读验证失败'],
      summary: verification?.message || 'AI 大事件回读验证失败',
      changedFiles: uniqStrings([
        ...result.changedFiles,
        toRelativePath(workspacePath, rawDraftPath),
        toRelativePath(workspacePath, payloadPath),
        toRelativePath(workspacePath, buildMetaPath),
        toRelativePath(workspacePath, verificationPath),
      ]),
      reportedEventDate: verification?.targetDate || payload.eventDate,
      reportedEventCount: verification?.saved || payload.events.length,
      verificationPassed: false,
      reportApiResponse: verification?.reportUrl,
    };
  }

  return {
    ...result,
    status: 'completed',
    summary: summarizeBigEventVerification(verification),
    blockers: [],
    changedFiles: uniqStrings([
      ...result.changedFiles,
      toRelativePath(workspacePath, rawDraftPath),
      toRelativePath(workspacePath, payloadPath),
      toRelativePath(workspacePath, buildMetaPath),
      toRelativePath(workspacePath, verificationPath),
    ]),
    reportedEventDate: verification.targetDate || payload.eventDate,
    reportedEventCount: verification.saved || payload.events.length,
    verificationPassed: true,
    reportApiResponse: verification.reportUrl,
  };
}

export async function finalizeWorkflowRun(
  resolvedWorkflowRef: string | undefined,
  workspacePath: string,
  artifactAbsDir: string,
  result: TaskResult,
  options?: WorkflowRuntimeFinalizeOptions,
): Promise<TaskResult> {
  const manifest = resolveWorkflowRuntimeManifest(resolvedWorkflowRef);

  switch (manifest.runtimeProfile) {
    case 'daily-digest':
      return Boolean(manifest.runtimeSkill || manifest.runtimeScriptsDir)
        ? finalizeAiDigestRun(manifest, workspacePath, artifactAbsDir, result)
        : result;
    case 'daily-events':
      return Boolean(manifest.runtimeSkill || manifest.runtimeScriptsDir)
        ? finalizeAiBigEventRun(manifest, workspacePath, artifactAbsDir, result)
        : result;
    case 'story-top-candidates':
      return finalizeStoryTopCandidatesRun(workspacePath, artifactAbsDir, result, options);
    default:
      return result;
  }
}

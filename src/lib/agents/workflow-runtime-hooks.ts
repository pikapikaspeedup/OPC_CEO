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
import { createLogger } from '../logger';

const log = createLogger('WorkflowRuntimeHooks');
const execFile = promisify(execFileCallback);

type BigEventContext = {
  status?: string;
  skipReason?: string | null;
  targetDate?: string;
  runMode?: 'first' | 'supplement' | string;
  articleCount?: number;
  sourceArticleIds?: number[];
  candidateArticles?: Array<{
    id?: number;
    title?: string;
    summary?: string;
    url?: string;
    createdAt?: string;
    aiCategory?: string;
    tags?: string[];
  }>;
  articleDetailsById?: Record<string, {
    id?: number;
    title?: string;
    aiCategory?: string;
    description?: string;
    contentSnippet?: string;
    tags?: string[];
    aiPeople?: Array<{ name?: string; company?: string; position?: string }>;
    url?: string;
  }>;
  existingEvents?: {
    sameDay?: BigEventPayload['events'];
    last30Days?: BigEventPayload['events'];
  };
};

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

export interface WorkflowRuntimePreparation {
  promptAppendix: string;
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

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value: string, maxLength = 1200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
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

async function fetchExistingDigest(targetDate: string): Promise<{
  title: string;
  summary: string;
  contentText: string;
} | null> {
  try {
    const res = await fetch(`https://api.aitrend.us/digest?date=${encodeURIComponent(targetDate)}`);
    if (!res.ok) return null;
    const payload = await res.json() as {
      data?: {
        exists?: boolean;
        run?: {
          title?: string;
          summary?: string;
          contentHtml?: string;
        };
      };
    };
    if (!payload.data?.exists || !payload.data.run) return null;
    return {
      title: payload.data.run.title || '',
      summary: payload.data.run.summary || '',
      contentText: stripHtml(payload.data.run.contentHtml || ''),
    };
  } catch {
    return null;
  }
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

async function prepareAiDigestContext(
  manifest: WorkflowRuntimeManifest,
  workspacePath: string,
  artifactAbsDir: string,
): Promise<string> {
  const runtime = resolveWorkflowRuntimeSupport(manifest);
  const targetDate = getAsiaShanghaiDateString();
  const contextPath = path.join(artifactAbsDir, 'prepared-ai-digest-context.json');
  const fetchScript = resolveRuntimeScriptPath(runtime, 'fetch_context.py');
  const reportScript = resolveRuntimeScriptPath(runtime, 'report_digest.py');
  const sections: string[] = [
    '## Prepared Daily Digest Context',
    `- Absolute target date: ${targetDate} (Asia/Shanghai)`,
    ...(runtime.scriptsDir ? [`- Workflow scripts dir: ${runtime.scriptsDir}`] : []),
    ...(runtime.skillName ? [`- Workflow helper skill: ${runtime.skillName}`] : []),
    `- Fetch script: ${fetchScript || 'missing'}`,
    `- Report script: ${reportScript || 'missing'}`,
  ];

  if (!fetchScript) {
    sections.push(
      '',
      '- Runtime preflight skipped: missing fetch_context.py helper in canonical workflow assets.',
      `- Today is still ${targetDate}; do not invent another date.`,
    );
    return sections.join('\n');
  }

  try {
    await runPythonScript(fetchScript, [
      '--date', targetDate,
      '--limit', '50',
      '--max-pages', '2',
      '--window-start-hour', '20',
      '--window-end-hour', '20',
      '--out', contextPath,
      '--insecure',
    ], workspacePath);
  } catch {
    // fetch_context returns non-zero only on hard failure; skip states still write output
  }

  let preparedContext: AiDigestPreparedContext | null = null;

  try {
    preparedContext = JSON.parse(fs.readFileSync(contextPath, 'utf-8')) as AiDigestPreparedContext;
  } catch {
    preparedContext = null;
  }

  if (preparedContext?.status === 'skip' && preparedContext.skipReason?.includes('digest_already_exists')) {
    const effectiveTargetDate = preparedContext.targetDate || targetDate;
    const digest = await fetchExistingDigest(effectiveTargetDate);
    if (digest) {
      sections.push(
        '',
        '### Existing digest for today already exists',
        `- Title: ${digest.title}`,
        `- Summary: ${digest.summary}`,
        '',
        '### Existing digest full text',
        digest.contentText,
      );
      sections.push(
        '',
        '### Hard constraints for summarization',
        '- Use the provided existing digest above as the factual source of truth for today.',
        '- Do not ask the user for more materials if the digest above is sufficient.',
        `- Do not invent another date. Today is ${effectiveTargetDate}.`,
      );
      return sections.join('\n');
    }
  }

  if (preparedContext?.status === 'ok') {
    const effectiveTargetDate = preparedContext.targetDate || targetDate;
    sections.push(
      '',
      `- Absolute target date: ${effectiveTargetDate} (Asia/Shanghai)`,
      ...(preparedContext.window?.start && preparedContext.window?.end
        ? [`- Context window: ${preparedContext.window.start} -> ${preparedContext.window.end}`]
        : []),
      `- Article count in context window: ${preparedContext.articleCount ?? 0}`,
      `- Source article ids: ${(preparedContext.sourceArticleIds ?? []).join(', ') || 'none'}`,
    );
    if (preparedContext.articles?.length) {
      sections.push('', '### Source articles');
      for (const article of preparedContext.articles.slice(0, 20)) {
        sections.push(`- ${article.title || ''}${article.summary ? ` — ${article.summary}` : ''}${article.url ? ` (${article.url})` : ''}`);
      }
    }
    sections.push(
      '',
      '### Hard constraints for summarization',
      '- Base the report strictly on the prepared article context above.',
      `- Do not invent another date. Today is ${effectiveTargetDate}.`,
    );
    return sections.join('\n');
  }

  if (preparedContext?.status === 'skip') {
    sections.push(
      '',
      `- Context preparation skipped: ${preparedContext.skipReason || 'unknown'}`,
      `- Today is still ${preparedContext.targetDate || targetDate}; do not invent another date.`,
    );
  }

  return sections.join('\n');
}

function renderEventList(
  title: string,
  events: BigEventPayload['events'] | undefined,
  maxItems: number,
): string[] {
  if (!events?.length) return [];
  const lines = ['', title];
  for (const event of events.slice(0, maxItems)) {
    lines.push(`- [${event.category}] ${event.title}${event.summary ? ` — ${event.summary}` : ''}`);
  }
  if (events.length > maxItems) {
    lines.push(`- ... 还有 ${events.length - maxItems} 条`);
  }
  return lines;
}

async function prepareAiBigEventContext(
  manifest: WorkflowRuntimeManifest,
  workspacePath: string,
  artifactAbsDir: string,
): Promise<string> {
  const runtime = resolveWorkflowRuntimeSupport(manifest);
  const targetDate = getAsiaShanghaiDateString();
  const contextPath = path.join(artifactAbsDir, 'prepared-ai-bigevent-context.json');
  const fetchScript = resolveRuntimeScriptPath(runtime, 'fetch_context.py');

  if (!fetchScript) {
    return [
      '## Prepared Daily Events Context',
      `- Target date: ${targetDate} (Asia/Shanghai)`,
      '- Context preparation failed: missing fetch_context.py helper.',
      '- If you cannot infer valid events from the prompt, output an empty events array in the required JSON schema.',
    ].join('\n');
  }

  try {
    await runPythonScript(fetchScript, [
      '--date', targetDate,
      '--limit', '50',
      '--max-pages', '3',
      '--out', contextPath,
      '--insecure',
    ], workspacePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    log.warn({ err: message }, 'ai_bigevent context preparation failed');
  }

  let preparedContext: BigEventContext | null = null;
  try {
    preparedContext = JSON.parse(fs.readFileSync(contextPath, 'utf-8')) as BigEventContext;
  } catch {
    preparedContext = null;
  }

  if (!preparedContext) {
    return [
      '## Prepared Daily Events Context',
      `- Target date: ${targetDate} (Asia/Shanghai)`,
      '- Context preparation failed; do not invent dates or sources.',
      '- If you cannot infer valid events from the prompt, output an empty events array in the required JSON schema.',
    ].join('\n');
  }

  const sections: string[] = [
    '## Prepared Daily Events Context',
    `- Target date: ${preparedContext.targetDate || targetDate} (Asia/Shanghai)`,
    `- Run mode: ${preparedContext.runMode || 'first'}`,
    `- Article count: ${preparedContext.articleCount ?? 0}`,
    `- Source article ids: ${(preparedContext.sourceArticleIds ?? []).join(', ') || 'none'}`,
  ];

  if (preparedContext.skipReason) {
    sections.push(`- Skip reason from preflight: ${preparedContext.skipReason}`);
  }

  sections.push(
    ...renderEventList('### Existing same-day events (do not duplicate these titles)', preparedContext.existingEvents?.sameDay, 12),
    ...renderEventList('### Recent 30-day events (avoid cross-day repeats unless there is a genuinely new fact)', preparedContext.existingEvents?.last30Days, 15),
  );

  if (preparedContext.candidateArticles?.length) {
    sections.push('', '### Candidate articles');
    for (const article of preparedContext.candidateArticles.slice(0, 18)) {
      sections.push(
        `- [${article.id ?? 'n/a'}] ${article.title || ''}${article.aiCategory ? ` [${article.aiCategory}]` : ''}${article.createdAt ? ` @ ${article.createdAt}` : ''}`,
        `  summary: ${article.summary || ''}`,
        ...(article.tags?.length ? [`  tags: ${article.tags.join(', ')}`] : []),
        ...(article.url ? [`  url: ${article.url}`] : []),
      );
    }
  }

  if (preparedContext.articleDetailsById) {
    sections.push('', '### Article details');
    const detailEntries = Object.values(preparedContext.articleDetailsById).slice(0, 12);
    for (const detail of detailEntries) {
      const people = (detail.aiPeople || [])
        .map((person) => [person.name, person.company].filter(Boolean).join(' / '))
        .filter(Boolean)
        .slice(0, 4);
      sections.push(
        `- [${detail.id ?? 'n/a'}] ${detail.title || ''}${detail.aiCategory ? ` [${detail.aiCategory}]` : ''}`,
        ...(detail.tags?.length ? [`  tags: ${detail.tags.join(', ')}`] : []),
        ...(detail.description ? [`  description: ${truncateText(detail.description, 500)}`] : []),
        ...(detail.contentSnippet ? [`  contentSnippet: ${truncateText(detail.contentSnippet, 900)}`] : []),
        ...(people.length ? [`  people: ${people.join('; ')}`] : []),
        ...(detail.url ? [`  url: ${detail.url}`] : []),
      );
    }
  }

  sections.push(
    '',
    '### Required output contract',
    '- Return exactly one ```json fenced block and make it the main output.',
    '- The JSON object must have: eventDate, events, notes.',
    `- eventDate must equal ${preparedContext.targetDate || targetDate}.`,
    '- Each event must include: category, title, summary, importance, sourceArticleIds, sourceUrls.',
    '- category must be one of: model_release, product_launch, funding, ipo_ma, policy, milestone, partnership, talent, open_source.',
    '- Use only sourceArticleIds/sourceUrls that appear in the prepared context above.',
    '- Do not repeat same-day or clearly duplicate 30-day historical events unless there is a materially new fact.',
    '- If there are no valid new events, return an empty events array and explain why in notes.',
  );

  return sections.join('\n');
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

export async function prepareWorkflowRuntimeContext(
  resolvedWorkflowRef: string | undefined,
  workspacePath: string,
  artifactAbsDir: string,
): Promise<WorkflowRuntimePreparation> {
  const manifest = resolveWorkflowRuntimeManifest(resolvedWorkflowRef);
  const hasRuntimeHelpers = Boolean(manifest.runtimeSkill || manifest.runtimeScriptsDir);

  switch (manifest.runtimeProfile) {
    case 'daily-digest':
      return hasRuntimeHelpers
        ? { promptAppendix: await prepareAiDigestContext(manifest, workspacePath, artifactAbsDir) }
        : { promptAppendix: '' };
    case 'daily-events':
      return hasRuntimeHelpers
        ? { promptAppendix: await prepareAiBigEventContext(manifest, workspacePath, artifactAbsDir) }
        : { promptAppendix: '' };
    default:
      return { promptAppendix: '' };
  }
}

export async function finalizeWorkflowRun(
  resolvedWorkflowRef: string | undefined,
  workspacePath: string,
  artifactAbsDir: string,
  result: TaskResult,
): Promise<TaskResult> {
  const manifest = resolveWorkflowRuntimeManifest(resolvedWorkflowRef);
  const hasRuntimeHelpers = Boolean(manifest.runtimeSkill || manifest.runtimeScriptsDir);

  switch (manifest.runtimeProfile) {
    case 'daily-digest':
      return hasRuntimeHelpers
        ? finalizeAiDigestRun(manifest, workspacePath, artifactAbsDir, result)
        : result;
    case 'daily-events':
      return hasRuntimeHelpers
        ? finalizeAiBigEventRun(manifest, workspacePath, artifactAbsDir, result)
        : result;
    default:
      return result;
  }
}

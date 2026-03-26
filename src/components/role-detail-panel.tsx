'use client';

import { useState, useCallback } from 'react';
import { marked } from 'marked';
import {
  Loader2,
  MessageSquare,
  FileCode2,
  Bot,
  Terminal,
  Search,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Pane, PaneHeader, StatusChip } from '@/components/ui/app-shell';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { RoleProgressFE, AgentRun, Step } from '@/lib/types';
import { api } from '@/lib/api';
import { useI18n } from '@/components/locale-provider';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RoleDetailPanelProps {
  /** The specific role to display */
  role: RoleProgressFE;
  /** Parent run for context (model, workspace, runId) */
  run: AgentRun;
  /** Human-readable stage title for breadcrumb context */
  stageTitle: string;
  /** Open a conversation in the main chat view (fallback) */
  onOpenConversation?: (id: string, title: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleStatusConfig: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending:   { label: 'Pending',   tone: 'neutral' },
  queued:    { label: 'Queued',    tone: 'neutral' },
  starting:  { label: 'Starting',  tone: 'info' },
  running:   { label: 'Running',   tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed:    { label: 'Failed',    tone: 'danger' },
};

const reviewDecisionConfig: Record<string, { label: string; color: string; bg: string }> = {
  approved: { label: 'Approved', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  revise:   { label: 'Revise',   color: 'text-amber-400',   bg: 'bg-amber-500/15' },
  rejected: { label: 'Rejected', color: 'text-red-400',     bg: 'bg-red-500/15' },
};

function formatDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function renderMarkdown(text: string): string {
  try { return marked.parse(text, { async: false }) as string; }
  catch { return text; }
}

const inputAuditConfig: Record<string, { label: string; tone: string; border: string }> = {
  verified: {
    label: 'Verified',
    tone: 'text-emerald-300',
    border: 'border-emerald-400/18 bg-emerald-400/[0.05]',
  },
  partial: {
    label: 'Partial',
    tone: 'text-amber-300',
    border: 'border-amber-400/18 bg-amber-400/[0.05]',
  },
  missing: {
    label: 'Missing',
    tone: 'text-red-300',
    border: 'border-red-400/18 bg-red-400/[0.05]',
  },
  not_applicable: {
    label: 'N/A',
    tone: 'text-white/50',
    border: 'border-white/10 bg-white/[0.03]',
  },
};

/** Render a single conversation step as a compact row */
function StepRow({ step }: { step: Step; index: number }) {
  const type = step.type;

  if (type === 'CORTEX_STEP_TYPE_USER_INPUT' || type === 'CORTEX_STEP_TYPE_PLANNER_INPUT') {
    const text = step.userInput?.items?.[0]?.text || '';
    if (!text) return null;
    return (
      <div className="flex gap-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
          <MessageSquare className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 text-[13px] text-white/70 whitespace-pre-wrap leading-5 line-clamp-3">
          {text}
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    const text = step.plannerResponse?.modifiedResponse || step.plannerResponse?.response || '';
    if (!text) return null;
    return (
      <div className="flex gap-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
          <Bot className="h-3 w-3" />
        </div>
        <div
          className="min-w-0 flex-1 chat-markdown text-[13px] text-white/60 leading-5 line-clamp-4"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text.slice(0, 500)) }}
        />
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_CODE_ACTION') {
    const desc = step.codeAction?.description || '';
    const file = step.codeAction?.actionSpec?.createFile?.absoluteUri
      || step.codeAction?.actionSpec?.editFile?.absoluteUri
      || step.codeAction?.actionSpec?.deleteFile?.absoluteUri || '';
    return (
      <div className="flex gap-3 py-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
          <FileCode2 className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          {desc && <div className="text-[12px] text-white/50 line-clamp-1">{desc}</div>}
          {file && <div className="text-[10px] text-white/30 font-mono truncate">{file.split('/').slice(-2).join('/')}</div>}
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_RUN_COMMAND') {
    const cmd = step.runCommand?.commandLine || step.runCommand?.command || '';
    return (
      <div className="flex gap-3 py-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
          <Terminal className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 font-mono text-[11px] text-white/40 truncate">{cmd}</div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_GREP_SEARCH' || type === 'CORTEX_STEP_TYPE_SEARCH_WEB') {
    const query = step.grepSearch?.query || step.searchWeb?.query || '';
    return (
      <div className="flex gap-3 py-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/8 text-white/40">
          <Search className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 text-[11px] text-white/40 truncate">{query}</div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_VIEW_FILE') {
    const uri = step.viewFile?.absoluteUri || '';
    return (
      <div className="flex gap-3 py-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/8 text-white/40">
          <Eye className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 font-mono text-[10px] text-white/30 truncate">{uri.split('/').slice(-2).join('/')}</div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
    const text = step.notifyUser?.notificationContent || '';
    return (
      <div className="flex gap-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
          <MessageSquare className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 text-[13px] text-sky-300/70 leading-5 line-clamp-3">
          {text.slice(0, 300)}
        </div>
      </div>
    );
  }

  // Skip minor step types (TASK_BOUNDARY, COMMAND_STATUS, etc.) to reduce noise
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RoleDetailPanel({
  role,
  run,
  stageTitle,
  onOpenConversation,
}: RoleDetailPanelProps) {
  const { t } = useI18n();
  const config = roleStatusConfig[role.status] || roleStatusConfig.pending;
  const duration = formatDuration(role.startedAt, role.finishedAt);
  const summary = role.result?.summary?.trim() || '';
  const changedFiles = role.result?.changedFiles || [];
  const decision = role.reviewDecision ? reviewDecisionConfig[role.reviewDecision] : null;
  const isActive = role.status === 'running' || role.status === 'starting';
  const inputAudit = role.inputReadAudit;
  const auditConfig = inputAudit ? (inputAuditConfig[inputAudit.status] || inputAuditConfig.not_applicable) : null;

  // Sheet drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSteps, setDrawerSteps] = useState<Step[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const handleOpenDrawer = useCallback(async () => {
    if (!role.childConversationId) return;
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError(null);
    try {
      const data = await api.conversationSteps(role.childConversationId);
      setDrawerSteps(data.steps || []);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setDrawerLoading(false);
    }
  }, [role.childConversationId]);

  return (
    <Pane tone="strong" className="p-6">
      <div className="flex flex-col gap-5">
        {/* Header */}
        <PaneHeader
          eyebrow={`${stageTitle} · Round ${role.round}`}
          title={role.roleId}
          meta={(
            <>
              <StatusChip tone={config.tone}>
                {isActive && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {config.label}
              </StatusChip>
              {decision && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', decision.bg, decision.color)}>
                  {decision.label}
                </span>
              )}
              {duration && <StatusChip>{duration}</StatusChip>}
            </>
          )}
          actions={(
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-[16px] border',
              role.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400' :
              isActive ? 'border-sky-400/20 bg-sky-400/10 text-sky-400' :
              role.status === 'failed' ? 'border-red-400/20 bg-red-400/10 text-red-400' :
              'border-white/10 bg-white/5 text-white/40',
            )}>
              <Bot className="h-4 w-4" />
            </div>
          )}
        />

        {/* ── Execution Summary ── */}
        {summary ? (
          <div className="rounded-2xl border border-emerald-400/12 bg-emerald-400/[0.04] px-5 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/60 mb-2">Role Execution Summary</div>
            <div
              className="chat-markdown text-[14px] leading-6 text-white/80"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
            />
          </div>
        ) : isActive ? (
          <div className="rounded-2xl border border-sky-400/12 bg-sky-400/[0.04] px-5 py-4 text-sm text-sky-300/80">
            <Loader2 className="inline mr-2 h-3.5 w-3.5 animate-spin" />
            Agent is currently executing…
          </div>
        ) : null}

        {role.promptSnapshot && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">Prompt Snapshot</div>
              {role.promptRecordedAt && (
                <div className="text-[10px] font-mono text-white/25">
                  {new Date(role.promptRecordedAt).toLocaleString()}
                </div>
              )}
            </div>
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/6 bg-black/20 px-3 py-3">
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-white/65">
                {role.promptSnapshot}
              </pre>
            </div>
          </div>
        )}

        {inputAudit && auditConfig && (
          <div className={cn('rounded-2xl border px-5 py-4', auditConfig.border)}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/35">Canonical Input Audit</div>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', auditConfig.tone, auditConfig.border)}>
                {auditConfig.label}
              </span>
            </div>
            <div className="mt-2 text-sm leading-6 text-white/72">{inputAudit.summary}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/6 bg-black/15 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Canonical Reads</div>
                <div className="mt-1 text-sm text-white/80">{inputAudit.canonicalReadCount}/{inputAudit.requiredArtifactCount}</div>
              </div>
              <div className="rounded-xl border border-white/6 bg-black/15 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Task Envelope</div>
                <div className="mt-1 text-sm text-white/80">{inputAudit.taskEnvelopeRead ? 'Read' : 'Not read'}</div>
              </div>
            </div>
            {inputAudit.entries.length > 0 && (
              <div className="mt-4 space-y-2">
                {inputAudit.entries.map((entry) => (
                  <div key={`${entry.artifactId}-${entry.canonicalPath}`} className="rounded-xl border border-white/6 bg-black/15 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white/85 truncate">{entry.title}</div>
                        <div className="mt-1 break-all font-mono text-[10px] text-white/35">{entry.canonicalPath}</div>
                      </div>
                      <span className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                        entry.canonicalRead ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
                      )}>
                        {entry.canonicalRead ? 'Read' : 'Missing'}
                      </span>
                    </div>
                    {(entry.alternateReadPaths?.length || 0) > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/60">Alternate Reads</div>
                        <div className="mt-1 space-y-1">
                          {entry.alternateReadPaths?.map((altPath) => (
                            <div key={altPath} className="break-all font-mono text-[10px] text-amber-200/80">
                              {altPath}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Changed Files ── */}
        {changedFiles.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">Changed Files ({changedFiles.length})</div>
            <div className="space-y-1.5">
              {changedFiles.map((file) => (
                <div key={file} className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5">
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400/60" />
                  <span className="min-w-0 truncate font-mono text-[11px] text-white/60">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Context from parent run ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Model</div>
            <div className="mt-1 text-sm text-white/70">{run.model?.split('/').pop() || 'default'}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Run ID</div>
            <div className="mt-1 text-sm font-mono text-white/70">{run.runId.slice(0, 8)}</div>
          </div>
          {role.startedAt && (
            <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Started</div>
              <div className="mt-1 text-sm font-mono text-white/70">{new Date(role.startedAt).toLocaleString()}</div>
            </div>
          )}
          {role.finishedAt && (
            <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Finished</div>
              <div className="mt-1 text-sm font-mono text-white/70">{new Date(role.finishedAt).toLocaleString()}</div>
            </div>
          )}
        </div>

        {/* ── Open conversation ── */}
        {role.childConversationId && (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl border-sky-400/18 bg-sky-400/8 text-sm font-medium text-sky-300 hover:bg-sky-400/15 hover:text-sky-200 w-full"
              onClick={handleOpenDrawer}
            >
              <FileCode2 className="mr-2 h-4 w-4" />
              View Process Steps
            </Button>
            {onOpenConversation && (
              <Button
                variant="outline"
                className="h-10 rounded-xl border-sky-400/26 bg-sky-400/12 text-sm font-medium text-sky-300 hover:bg-sky-400/20 hover:text-sky-200 w-full"
                onClick={() => onOpenConversation(role.childConversationId!, `${role.roleId} · Round ${role.round}`)}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                {t('projects.openConversation')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Conversation drawer (Sheet) ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:!max-w-xl md:!max-w-2xl bg-[#0c131f] border-white/10 overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle className="text-white/90">{role.roleId} · R{role.round}</SheetTitle>
            <SheetDescription className="text-white/40">
              {stageTitle} · {drawerSteps.length} steps
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6">
            {drawerLoading ? (
              <div className="flex items-center justify-center py-12 text-white/40">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading conversation…
              </div>
            ) : drawerError ? (
              <div className="rounded-xl border border-red-400/15 bg-red-400/8 px-4 py-3 text-sm text-red-300">
                {drawerError}
              </div>
            ) : drawerSteps.length === 0 ? (
              <div className="text-center py-12 text-white/30 text-sm">
                No conversation steps found.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {drawerSteps.map((step, i) => (
                  <StepRow key={i} step={step} index={i} />
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Pane>
  );
}

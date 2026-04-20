import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { useI18n } from '@/components/locale-provider';
import type { Step, StepsData } from '@/lib/types';
import { buildConversationErrorDisplay } from '@/lib/conversation-error';
import { renderMarkdown } from '@/lib/render-markdown';
import { cn } from '@/lib/utils';
import {
  Eye, Search, Terminal, Globe, FolderOpen, AlertTriangle,
  FileCode, FilePen, Sparkles, ChevronDown, ExternalLink,
  CheckCircle2, XCircle, Clock, Wrench, Rocket, RotateCcw,
  Trash2, Keyboard, MonitorPlay, FileSearch, Loader2, Ban, Bot, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatProps {
  steps: StepsData | null;
  loading: boolean;
  currentModel: string;
  onProceed?: (uri: string) => void;
  onRevert?: (stepIndex: number) => void;
  totalSteps?: number;
  isActive?: boolean;
}

const TOOL_TYPES = new Set([
  'CORTEX_STEP_TYPE_CODE_ACTION',
  'CORTEX_STEP_TYPE_VIEW_FILE',
  'CORTEX_STEP_TYPE_GREP_SEARCH',
  'CORTEX_STEP_TYPE_RUN_COMMAND',
  'CORTEX_STEP_TYPE_SEARCH_WEB',
  'CORTEX_STEP_TYPE_LIST_DIRECTORY',
  'CORTEX_STEP_TYPE_FIND',
  'CORTEX_STEP_TYPE_COMMAND_STATUS',
  'CORTEX_STEP_TYPE_SEND_COMMAND_INPUT',
  'CORTEX_STEP_TYPE_BROWSER_SUBAGENT',
]);

const VISIBLE = new Set([
  'CORTEX_STEP_TYPE_USER_INPUT',
  'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
  'CORTEX_STEP_TYPE_TASK_BOUNDARY',
  'CORTEX_STEP_TYPE_NOTIFY_USER',
  'CORTEX_STEP_TYPE_ERROR_MESSAGE',
  ...TOOL_TYPES,
]);

// Step status helpers
const isGenerating = (s?: string) => s === 'CORTEX_STEP_STATUS_GENERATING';
const isPending = (s?: string) => s === 'CORTEX_STEP_STATUS_PENDING';
const isRunning = (s?: string) => s === 'CORTEX_STEP_STATUS_RUNNING';
const isCanceled = (s?: string) => s === 'CORTEX_STEP_STATUS_CANCELED';
const isError = (s?: string) => s === 'CORTEX_STEP_STATUS_ERROR';

const modeStyles: Record<string, { label: string; bg: string; border: string; iconColor: string }> = {
  planning: { label: 'PLANNING', bg: 'bg-amber-500/10 text-amber-500', border: 'border-amber-500/30', iconColor: 'text-amber-500' },
  execution: { label: 'EXECUTION', bg: 'bg-indigo-500/10 text-indigo-500', border: 'border-indigo-500/30', iconColor: 'text-indigo-500' },
  verification: { label: 'VERIFICATION', bg: 'bg-emerald-500/10 text-emerald-500', border: 'border-emerald-500/30', iconColor: 'text-emerald-500' },
};

const TIMELINE_OFFSET = 'ml-11';



function getToolLabel(step: Step, t: (key: string, values?: Record<string, string | number>) => string): { icon: React.ReactNode; text: string; statusIcon?: React.ReactNode } {
  const type = step.type || '';
  const status = step.status || '';

  // Status indicator
  let statusIcon: React.ReactNode = null;
  if (isPending(status)) statusIcon = <Clock className="w-3 h-3 text-muted-foreground animate-pulse" />;
  else if (isRunning(status) || isGenerating(status)) statusIcon = <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />;
  else if (isCanceled(status)) statusIcon = <Ban className="w-3 h-3 text-orange-400" />;
  else if (isError(status)) statusIcon = <XCircle className="w-3 h-3 text-destructive" />;

  if (type === 'CORTEX_STEP_TYPE_CODE_ACTION') {
    const ca = step.codeAction || {};
    const spec = ca.actionSpec || {};
    const isNew = !!spec.createFile;
    const isDel = !!spec.deleteFile;
    const file = (spec.createFile?.absoluteUri || spec.editFile?.absoluteUri || spec.deleteFile?.absoluteUri || '').split('/').pop() || '';
    return {
      icon: isDel ? <Trash2 className="w-3.5 h-3.5 text-red-500" /> : isNew ? <Sparkles className="w-3.5 h-3.5 text-emerald-500" /> : <FilePen className="w-3.5 h-3.5 text-indigo-500" />,
      text: isDel
        ? t('chat.tool.delete', { name: file || 'file' })
        : isNew
          ? t('chat.tool.create', { name: file || 'file' })
          : t('chat.tool.edit', { name: file || 'file' }),
      statusIcon,
    };
  }
  if (type === 'CORTEX_STEP_TYPE_VIEW_FILE') {
    return { icon: <Eye className="w-3.5 h-3.5 text-zinc-400" />, text: t('chat.tool.view', { name: (step.viewFile?.absoluteUri || '').split('/').pop() || 'file' }), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_GREP_SEARCH') {
    const gs = step.grepSearch || {};
    return { icon: <Search className="w-3.5 h-3.5 text-zinc-400" />, text: t('chat.tool.grep', { query: gs.query || gs.searchPattern || '...' }), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_RUN_COMMAND') {
    const cmd = step.runCommand?.command || step.runCommand?.commandLine || '';
    return { icon: <Terminal className="w-3.5 h-3.5 text-emerald-500" />, text: cmd.slice(0, 60), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_SEARCH_WEB') {
    return { icon: <Globe className="w-3.5 h-3.5 text-sky-500" />, text: t('chat.tool.search', { query: step.searchWeb?.query || '...' }), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_LIST_DIRECTORY') {
    return { icon: <FolderOpen className="w-3.5 h-3.5 text-amber-500/70" />, text: t('chat.tool.list', { name: (step.listDirectory?.path || '').split('/').pop() || '...' }), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_FIND') {
    const f = step.find || {};
    return { icon: <FileSearch className="w-3.5 h-3.5 text-cyan-500" />, text: t('chat.tool.find', { pattern: f.pattern || '...', name: (f.searchDirectory || '').split('/').pop() || '...' }), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_COMMAND_STATUS') {
    return { icon: <Terminal className="w-3.5 h-3.5 text-zinc-400" />, text: t('chat.tool.commandOutput'), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_SEND_COMMAND_INPUT') {
    return { icon: <Keyboard className="w-3.5 h-3.5 text-amber-400" />, text: t('chat.tool.sendInput'), statusIcon };
  }
  if (type === 'CORTEX_STEP_TYPE_BROWSER_SUBAGENT') {
    const bs = step.browserSubagent || {};
    return { icon: <MonitorPlay className="w-3.5 h-3.5 text-purple-500" />, text: t('chat.tool.browser', { name: bs.taskName || bs.task?.slice(0, 40) || '...' }), statusIcon };
  }
  return { icon: <Wrench className="w-3.5 h-3.5" />, text: t('chat.tool.action'), statusIcon };
}

function ToolGroup({ steps, t }: { steps: Step[]; t: (key: string, values?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 1) {
    const { icon, text, statusIcon } = getToolLabel(steps[0], t);
    return (
      <div className={cn('mb-2 flex items-center gap-3 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-1.5 text-[11px] text-[var(--app-text-soft)]', TIMELINE_OFFSET, isCanceled(steps[0].status) && 'opacity-40 line-through')}>
        <div className="shrink-0">{icon}</div>
        <span className="truncate font-mono flex-1">{text}</span>
        {statusIcon}
      </div>
    );
  }

  return (
    <div className={cn('mb-3', TIMELINE_OFFSET)}>
      <Button
        variant="ghost"
        className="h-8 w-full justify-start gap-3 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 text-[var(--app-text-soft)] transition-all hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="w-3.5 h-3.5" />
        <span className="font-semibold text-[11px] uppercase tracking-wider">{t('chat.actions', { count: steps.length })}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform ml-auto', expanded && 'rotate-180')} />
      </Button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {steps.map((s, i) => {
            const { icon, text, statusIcon } = getToolLabel(s, t);
            return (
              <div key={i} className={cn('flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--app-border-soft)] bg-black/10 px-3 py-2 text-[11px] text-[var(--app-text-soft)] transition-all hover:border-solid', isCanceled(s.status) && 'opacity-40 line-through')}>
                <div className="shrink-0">{icon}</div>
                <span className="truncate font-mono flex-1">{text}</span>
                {statusIcon}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RenderItem = { type: 'step'; step: Step; originalIndex: number } | { type: 'tools'; steps: Step[] };

function groupSteps(taggedSteps: { step: Step; originalIndex: number }[]): RenderItem[] {
  const items: RenderItem[] = [];
  let toolBuf: Step[] = [];

  function flushTools() {
    if (toolBuf.length > 0) {
      items.push({ type: 'tools', steps: [...toolBuf] });
      toolBuf = [];
    }
  }

  for (const t of taggedSteps) {
    if (TOOL_TYPES.has(t.step.type || '')) {
      toolBuf.push(t.step);
    } else {
      flushTools();
      items.push({ type: 'step', step: t.step, originalIndex: t.originalIndex });
    }
  }
  flushTools();
  return items;
}

function StepBubble({ step, originalIndex, allSteps, isFastMode, onProceed, onRevert, isActive, t }: { step: Step; originalIndex: number; allSteps: Step[]; isFastMode?: boolean; onProceed?: (uri: string) => void; onRevert?: (stepIndex: number) => void; isActive?: boolean; t: (key: string, values?: Record<string, string | number>) => string }) {
  const type = step.type || '';

  if (type === 'CORTEX_STEP_TYPE_USER_INPUT') {
    const items = step.userInput?.items || [];
    const media = step.userInput?.media || [];
    const text = items.filter(i => i.text).map(i => i.text).join('').trim();
    const files = items.filter(i => i.item?.file).map(i => Object.values(i.item!.file!.workspaceUrisToRelativePaths || {})[0] || i.item!.file!.absoluteUri?.split('/').pop());

    if (!text && files.length === 0 && media.length === 0) return null;
    return (
      <div className={cn('group mb-6 flex justify-end', isFastMode ? 'mt-4' : 'mt-7')}>
        <div className="flex w-full max-w-[84%] items-start justify-end gap-3 sm:max-w-[72%]">
          {onRevert && (
            <Button
              variant="ghost"
              size="icon"
              className="mt-2 h-8 w-8 shrink-0 rounded-full border border-white/6 bg-black/10 text-[var(--app-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--app-border-strong)] hover:bg-white/[0.04] hover:text-[var(--app-text)]"
              onClick={() => onRevert(originalIndex)}
              title={t('chat.revertMessage')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          <div className="flex flex-col gap-3 rounded-[28px] rounded-br-[10px] border border-cyan-300/18 bg-[linear-gradient(135deg,rgba(88,243,212,0.96)_0%,rgba(49,182,247,0.92)_100%)] px-5 py-4 text-[15px] leading-relaxed text-slate-950 shadow-[0_24px_60px_rgba(49,182,247,0.2)]">
            {media.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {media.map((m, idx) => (
                  <Image
                    key={idx}
                    src={m.inlineData ? `data:${m.mimeType || 'image/png'};base64,${m.inlineData}` : (m.uri || '')}
                    alt="Attached Graphic"
                    width={200}
                    height={200}
                    unoptimized
                    className="max-h-[220px] max-w-[220px] rounded-[18px] border border-slate-950/10 object-cover"
                  />
                ))}
              </div>
            )}
            {text && <div className="whitespace-pre-wrap">{text}</div>}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 rounded-full border border-slate-950/12 bg-slate-950/8 px-3 py-1.5 text-xs font-medium text-slate-950">
                    <FileCode className="w-3 h-3" />
                    <span className="truncate max-w-[150px]">{file}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Avatar className="mt-2 hidden h-9 w-9 shrink-0 border border-white/8 bg-[var(--app-raised)] shadow-[0_16px_36px_rgba(0,0,0,0.2)] sm:flex">
            <AvatarFallback className="bg-slate-950 text-[10px] font-bold text-white">YOU</AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    const pr = step.plannerResponse || {};
    const text = pr.modifiedResponse || pr.response || '';
    const streaming = isGenerating(step.status);
    // Show streaming text even if short; only hide empty DONE responses
    if (!streaming && (!text || text.length < 3)) return null;
    return (
      <div className={cn('group flex', isFastMode ? 'mb-2 mt-4' : 'mb-4 mt-7')}>
        <div className="flex w-full max-w-full items-start gap-3">
          <Avatar className="mt-1 h-9 w-9 shrink-0 border border-white/8 bg-[var(--app-raised)] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
            <AvatarFallback className={cn(
              'text-white',
              isFastMode ? 'bg-gradient-to-br from-violet-500 to-sky-500' : 'bg-[linear-gradient(135deg,#1d4ed8_0%,#2563eb_60%,#38bdf8_100%)]'
            )}>
              {isFastMode ? <Zap className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
          <div className={cn(
            'min-w-0 flex-1 overflow-hidden rounded-[28px] rounded-tl-[10px] border px-5 py-4 text-[15px] leading-relaxed chat-markdown shadow-[0_24px_70px_rgba(0,0,0,0.18)]',
            isFastMode
              ? 'border-white/6 bg-[linear-gradient(180deg,rgba(21,24,46,0.82)_0%,rgba(14,20,37,0.9)_100%)]'
              : 'border-white/6 bg-[linear-gradient(180deg,rgba(18,28,43,0.94)_0%,rgba(12,19,31,0.98)_100%)]',
            streaming && 'border-[var(--app-border-strong)] shadow-[0_0_0_1px_rgba(88,243,212,0.14),0_24px_70px_rgba(0,0,0,0.18)]'
          )}>
            {text ? (
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
            ) : streaming ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">{t('chat.thinking')}</span>
              </div>
            ) : null}
            {streaming && text && (
              <span className="inline-block w-0.5 h-5 bg-indigo-500 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
          {!streaming && onRevert && (
            <Button
              variant="ghost"
              size="icon"
              className="mt-2 h-8 w-8 shrink-0 rounded-full border border-white/6 bg-black/10 text-[var(--app-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--app-border-strong)] hover:bg-white/[0.04] hover:text-[var(--app-text)]"
              onClick={() => onRevert(originalIndex)}
              title={t('chat.revertMessage')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_TASK_BOUNDARY') {
    const tb = step.taskBoundary || {};
    const mode = (tb.mode || '').replace('AGENT_MODE_', '').toLowerCase();
    const ms = modeStyles[mode] || modeStyles.execution;
    return (
      <div className={cn('my-7', TIMELINE_OFFSET)}>
        <div className={cn('border-l-2 pl-5 py-1', ms.border)}>
          <div className="flex items-center gap-3">
            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest', ms.bg)}>
              {ms.label}
            </span>
            <span className="font-bold text-sm tracking-tight">{tb.taskName || t('chat.taskUpdate')}</span>
          </div>
          {tb.taskStatus && <div className="mt-2 text-[13px] font-medium text-muted-foreground">{tb.taskStatus}</div>}
          {tb.taskSummary && (
            <div className="mt-3 rounded-[16px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-[12px] leading-relaxed text-[var(--app-text-soft)]">
              {tb.taskSummary}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
    const nu = step.notifyUser || {};
    const content = nu.notificationContent || '';
    // Use rich fields from gRPC, with fallbacks to legacy fields
    const blocked = nu.blockedOnUser ?? nu.isBlocking ?? false;
    const reviewPaths = nu.pathsToReview || nu.reviewAbsoluteUris || [];
    const autoProc = nu.shouldAutoProceed ?? false;
    // When autoProc is true, the agent continues without a USER_INPUT step,
    // so we check for ANY subsequent step as evidence that it already proceeded.
    // When the conversation is idle (not active), any pending blocked notify_user
    // has already been handled — the agent either auto-proceeded or finished.
    // Note: WS stream data may not include shouldAutoProceed, so we can't rely
    // solely on autoProc to determine completion for idle conversations.
    const conversationIdle = isActive === false;
    const hasUserFollowup = allSteps.slice(originalIndex + 1).some(s => s.type === 'CORTEX_STEP_TYPE_USER_INPUT');
    const hasAnyFollowup = originalIndex < allSteps.length - 1;
    const hasFollowup = conversationIdle
      ? true  // Idle conversation: approval already handled, never show buttons
      : autoProc
        ? hasAnyFollowup
        : hasUserFollowup;
    return (
      <div className="mb-6 mt-6 flex">
        <div className="flex w-full max-w-full items-start gap-3">
          <Avatar className="mt-1 h-9 w-9 shrink-0 border border-white/8 bg-[var(--app-raised)] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
            <AvatarFallback className="bg-[linear-gradient(135deg,#1d4ed8_0%,#2563eb_60%,#38bdf8_100%)] text-white">
              <Bot className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 rounded-[28px] rounded-tl-[10px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,28,43,0.94)_0%,rgba(12,19,31,0.98)_100%)] px-5 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
            {content && (
              <div className="chat-markdown text-[15px] leading-relaxed mb-4" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
            )}
            {reviewPaths.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                  {t('chat.reviewFiles')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reviewPaths.map(uri => {
                  const name = uri.replace('file://', '').split('/').pop();
                  return (
                    <Card key={uri} className="cursor-pointer border-dashed border-white/8 bg-white/[0.03] shadow-none transition-colors hover:bg-white/[0.05]" onClick={() => window.open(uri, '_blank')}>
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <FileCode className="h-4 w-4 text-indigo-500 shrink-0" />
                          <span className="text-xs font-semibold truncate">{name}</span>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      </div>
                    </Card>
                  );
                })}
                </div>
              </div>
            )}

            {/* Blocking approval section */}
            {blocked && !hasFollowup && (
              <div className="mt-8 p-5 rounded-xl border-l-4 border-l-amber-500 border bg-amber-500/[0.03] space-y-4">
                <div className="flex items-center gap-3 text-amber-600 dark:text-amber-500">
                  <Clock className="w-4 h-4 animate-pulse" />
                  <span className="text-sm font-bold uppercase tracking-wider">
                    {autoProc ? t('chat.autoProceeding') : t('chat.approvalRequired')}
                  </span>
                </div>
                {!autoProc && (
                  <div className="flex gap-3">
                    <Button onClick={() => onProceed?.(reviewPaths[0] || '')} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-10 shadow-lg shadow-indigo-500/10">
                      <CheckCircle2 className="w-4 h-4 mr-2" /> {t('chat.proceed')}
                    </Button>
                    <Button variant="outline" className="flex-1 border-zinc-500/20 hover:bg-zinc-500/5 font-bold h-10">
                      <XCircle className="w-4 h-4 mr-2" /> {t('chat.reject')}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Auto-proceed indicator (when already proceeded) */}
            {autoProc && hasFollowup && (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                <span>{t('chat.autoProceeded')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
    const errorDisplay = buildConversationErrorDisplay(step.errorMessage);
    return (
      <div className={cn('my-4', TIMELINE_OFFSET)}>
        <div className="max-w-[760px] rounded-[24px] border border-destructive/20 bg-destructive/[0.06] px-5 py-4 shadow-[0_12px_32px_rgba(220,38,38,0.08)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-destructive">
                  {errorDisplay.title || t('chat.errorOccurred')}
                </p>
                {errorDisplay.code && (
                  <span className="rounded-full border border-destructive/20 bg-background/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-destructive/80">
                    {t('chat.errorCode', { code: errorDisplay.code })}
                  </span>
                )}
              </div>
              {errorDisplay.summary && (
                <p className="text-sm leading-6 text-destructive/80">
                  {errorDisplay.summary}
                </p>
              )}
              {errorDisplay.technicalDetails && (
                <details className="rounded-2xl border border-destructive/15 bg-background/50 px-4 py-3">
                  <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    {t('chat.errorDetails')}
                  </summary>
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                    {errorDisplay.technicalDetails}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function Chat({ steps, loading, onProceed, onRevert, isActive }: ChatProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const renderItems = useMemo(() => {
    if (!steps?.steps) return [];
    const visible = steps.steps
      .map((s, idx) => ({ step: s, originalIndex: idx }))
      .filter(x => VISIBLE.has(x.step.type || ''));
    return groupSteps(visible);
  }, [steps]);

  // Detect Fast mode: no TASK_BOUNDARY steps in the conversation
  const isFastMode = useMemo(() => {
    if (!steps?.steps || steps.steps.length === 0) return false;
    return !steps.steps.some(s => s.type === 'CORTEX_STEP_TYPE_TASK_BOUNDARY');
  }, [steps]);

  const allSteps = steps?.steps || [];

  // Robust auto-scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Scroll on initial load and message updates
  useEffect(() => {
    if (renderItems.length > 0) {
      // Small timeout to ensure DOM is ready
      const timer = setTimeout(() => scrollToBottom('smooth'), 100);
      return () => clearTimeout(timer);
    }
  }, [renderItems, scrollToBottom]);

  if (!steps && !loading) {
    return (
      <div className="flex min-h-full items-center justify-center px-5 py-10">
        <div className="w-full max-w-[560px] rounded-[32px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,28,43,0.88)_0%,rgba(12,19,31,0.96)_100%)] px-8 py-10 text-center shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
          <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)] shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
            <Rocket className="h-7 w-7" />
          </div>
          <h2 className="app-heading text-3xl">{t('chat.emptyTitle')}</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[var(--app-text-soft)]">{t('chat.emptySubtitle')}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/6 bg-white/[0.03] px-5 py-4">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[16px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text)]">
                <span className="font-mono text-sm">/</span>
              </div>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--app-text-muted)]">{t('chat.skillsHint')}</div>
            </div>
            <div className="rounded-[22px] border border-white/6 bg-white/[0.03] px-5 py-4">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[16px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text)]">
                <span className="font-mono text-sm">@</span>
              </div>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--app-text-muted)]">{t('chat.filesHint')}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !steps) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-5 text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs font-bold uppercase tracking-widest">{t('chat.initializing')}</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="mx-auto flex min-h-full w-full max-w-[980px] flex-col px-4 py-6 md:px-6 md:py-8 lg:px-8" ref={viewportRef}>
        {renderItems.map((item, i) =>
          item.type === 'tools'
            ? <ToolGroup key={i} steps={item.steps} t={t} />
            : <StepBubble key={i} step={item.step} originalIndex={item.originalIndex} allSteps={allSteps} isFastMode={isFastMode} onProceed={onProceed} onRevert={onRevert} isActive={isActive} t={t} />
        )}
        <div ref={bottomRef} className="h-4 w-full shrink-0" />
      </div>
    </ScrollArea>
  );
}

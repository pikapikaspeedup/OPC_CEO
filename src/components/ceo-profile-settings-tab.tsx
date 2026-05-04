'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MessageSquareQuote, Save, ShieldAlert, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import type { CEOProfileFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

type CEOProfileDraft = {
  name: string;
  tone: string;
  prioritiesText: string;
  activeFocusText: string;
  verbosity: NonNullable<NonNullable<CEOProfileFE['communicationStyle']>['verbosity']>;
  escalationStyle: NonNullable<NonNullable<CEOProfileFE['communicationStyle']>['escalationStyle']>;
  riskTolerance: NonNullable<CEOProfileFE['riskTolerance']>;
  reviewPreference: NonNullable<CEOProfileFE['reviewPreference']>;
};

type FeedbackType = NonNullable<CEOProfileFE['feedbackSignals']>[number]['type'];

type SaveState = {
  status: 'idle' | 'saving' | 'ok' | 'error';
  message?: string;
};

const VERBOSITY_LABELS: Record<CEOProfileDraft['verbosity'], string> = {
  brief: '精简',
  normal: '中等',
  detailed: '详细',
};

const ESCALATION_LABELS: Record<CEOProfileDraft['escalationStyle'], string> = {
  aggressive: '强提醒',
  balanced: '平衡',
  minimal: '克制',
};

const RISK_LABELS: Record<CEOProfileDraft['riskTolerance'], string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const REVIEW_LABELS: Record<CEOProfileDraft['reviewPreference'], string> = {
  'result-first': '结果优先',
  'process-first': '过程优先',
  balanced: '平衡',
};

const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  preference: '偏好调整',
  correction: '纠偏',
  approval: '认可',
  rejection: '否决',
};

function SectionCard({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-[20px] border border-[#dfe5ee] bg-white p-5 shadow-[0_14px_30px_rgba(28,44,73,0.05)]', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/[0.08] text-sky-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--app-text)]">{title}</div>
          {description ? <div className="mt-1 text-xs leading-6 text-[var(--app-text-soft)]">{description}</div> : null}
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-[168px_minmax(0,1fr)] lg:items-start lg:gap-4">
      <div>
        <div className="text-xs font-medium text-[var(--app-text)]">{label}</div>
        {hint ? <div className="mt-1 text-[11px] leading-5 text-[var(--app-text-muted)]">{hint}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function splitEditorList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function joinEditorList(value?: string[]): string {
  return (value || []).join('\n');
}

function profileToDraft(profile: CEOProfileFE): CEOProfileDraft {
  return {
    name: profile.identity.name,
    tone: profile.identity.tone || '',
    prioritiesText: joinEditorList(profile.priorities),
    activeFocusText: joinEditorList(profile.activeFocus),
    verbosity: profile.communicationStyle?.verbosity || 'normal',
    escalationStyle: profile.communicationStyle?.escalationStyle || 'balanced',
    riskTolerance: profile.riskTolerance || 'medium',
    reviewPreference: profile.reviewPreference || 'balanced',
  };
}

function StatusMessage({ state }: { state: SaveState }) {
  if (state.status === 'idle') return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
        state.status === 'ok' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
        state.status === 'error' && 'border-red-500/20 bg-red-500/10 text-red-700',
        state.status === 'saving' && 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)]',
      )}
    >
      {state.status === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {state.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {state.status === 'error' ? <AlertCircle className="h-3.5 w-3.5" /> : null}
      <span>{state.message}</span>
    </div>
  );
}

export default function CEOProfileSettingsTab() {
  const [profile, setProfile] = useState<CEOProfileFE | null>(null);
  const [draft, setDraft] = useState<CEOProfileDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [feedbackState, setFeedbackState] = useState<SaveState>({ status: 'idle' });
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('preference');
  const [feedbackContent, setFeedbackContent] = useState('');

  useEffect(() => {
    api.ceoProfile()
      .then((data) => {
        setProfile(data);
        setDraft(profileToDraft(data));
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '无法加载 CEO profile');
      })
      .finally(() => setLoading(false));
  }, []);

  const baselineDraft = useMemo(() => (profile ? profileToDraft(profile) : null), [profile]);
  const isDirty = draft && baselineDraft
    ? JSON.stringify(draft) !== JSON.stringify(baselineDraft)
    : false;
  const recentFeedback = useMemo(() => profile?.feedbackSignals?.slice(0, 4) || [], [profile]);
  const activeFocusCount = useMemo(
    () => splitEditorList(draft?.activeFocusText || '').length,
    [draft?.activeFocusText],
  );

  const updateDraft = <K extends keyof CEOProfileDraft>(key: K, value: CEOProfileDraft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSaveProfile = async () => {
    if (!draft) return;

    setSaveState({ status: 'saving', message: '正在保存 CEO profile…' });
    try {
      const nextProfile = await api.updateCeoProfile({
        identity: {
          name: draft.name.trim() || 'AI CEO',
          role: 'ceo',
          tone: draft.tone.trim() || undefined,
        },
        priorities: splitEditorList(draft.prioritiesText),
        activeFocus: splitEditorList(draft.activeFocusText).slice(0, 5),
        communicationStyle: {
          verbosity: draft.verbosity,
          escalationStyle: draft.escalationStyle,
        },
        riskTolerance: draft.riskTolerance,
        reviewPreference: draft.reviewPreference,
      });
      setProfile(nextProfile);
      setDraft(profileToDraft(nextProfile));
      setSaveState({ status: 'ok', message: '结构化 CEO 偏好已保存。' });
      window.setTimeout(() => setSaveState({ status: 'idle' }), 3000);
    } catch (err) {
      setSaveState({
        status: 'error',
        message: err instanceof Error ? err.message : '保存 CEO profile 失败',
      });
    }
  };

  const handleAppendFeedback = async () => {
    if (!feedbackContent.trim()) return;

    setFeedbackState({ status: 'saving', message: '正在记录反馈信号…' });
    try {
      const nextProfile = await api.appendCeoFeedback({
        type: feedbackType,
        content: feedbackContent.trim(),
      });
      setProfile(nextProfile);
      setFeedbackContent('');
      setFeedbackType('preference');
      setFeedbackState({ status: 'ok', message: '反馈信号已写入 CEO profile。' });
      window.setTimeout(() => setFeedbackState({ status: 'idle' }), 3000);
    } catch (err) {
      setFeedbackState({
        status: 'error',
        message: err instanceof Error ? err.message : '反馈写入失败',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[var(--app-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载 CEO profile…
      </div>
    );
  }

  if (error || !draft || !profile) {
    return (
      <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.05] p-5 text-sm text-red-700">
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" />
          无法加载 CEO profile
        </div>
        <div className="mt-2 text-xs leading-6 text-red-700/75">{error || 'unknown error'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="个人信息"
        description="用于管理你的身份、当前关注重点与 AI 默认协作语气。"
        icon={<Sparkles className="h-4 w-4" />}
        className="border-sky-500/15 bg-[linear-gradient(135deg,rgba(47,109,246,0.05),rgba(255,255,255,1)_34%,rgba(248,250,252,0.95))]"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">身份</div>
            <div className="mt-2 text-base font-semibold text-[var(--app-text)]">{profile.identity.name}</div>
            <div className="mt-1 text-xs text-[var(--app-text-soft)]">{profile.identity.tone || '未设置 tone'}</div>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">关注点</div>
            <div className="mt-2 text-base font-semibold text-[var(--app-text)]">{profile.activeFocus?.length || 0}</div>
            <div className="mt-1 text-xs text-[var(--app-text-soft)]">当前活跃关注点</div>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近更新</div>
            <div className="mt-2 text-base font-semibold text-[var(--app-text)]">
              {new Date(profile.updatedAt).toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-[var(--app-text-soft)]">最近一次写入时间</div>
          </div>
        </div>

      </SectionCard>

      <SectionCard
        title="沟通偏好"
        description="控制 AI 汇报详略、风险提醒强度与默认评审取向。"
        icon={<ShieldAlert className="h-4 w-4" />}
      >
        <FieldRow label="显示名称" hint="用于结构化身份回显。">
          <Input
            value={draft.name}
            onChange={(event) => updateDraft('name', event.target.value)}
            placeholder="AI CEO"
            className={cn('h-10', workspaceFieldClassName)}
          />
        </FieldRow>

        <FieldRow label="工作语气" hint="例如 pragmatic、direct、calm。">
          <Input
            value={draft.tone}
            onChange={(event) => updateDraft('tone', event.target.value)}
            placeholder="pragmatic"
            className={cn('h-10', workspaceFieldClassName)}
          />
        </FieldRow>

        <FieldRow label="优先级" hint="每行一条，保存时会自动去重。">
          <Textarea
            value={draft.prioritiesText}
            onChange={(event) => updateDraft('prioritiesText', event.target.value)}
            placeholder={'例如：\n增长速度\n稳定性\n交付确定性'}
            className={cn('min-h-28 rounded-2xl', workspaceFieldClassName)}
          />
        </FieldRow>

        <FieldRow label="当前关注重点" hint="最多保留 5 条，超出部分保存时会被截断。">
          <div className="space-y-2">
            <Textarea
              value={draft.activeFocusText}
              onChange={(event) => updateDraft('activeFocusText', event.target.value)}
              placeholder={'例如：\n部门设置解耦\n开发态响应速度\n可观测性补齐'}
              className={cn('min-h-28 rounded-2xl', workspaceFieldClassName)}
            />
            <div className={cn('text-[11px] text-[var(--app-text-muted)]', activeFocusCount > 5 && 'text-amber-700')}>
              当前录入 {activeFocusCount} 条，保存后最多保留 5 条。
            </div>
          </div>
        </FieldRow>

        <div className="grid gap-4 xl:grid-cols-2">
          <FieldRow label="信息详略" hint="决定汇报偏向简报还是展开说明。">
            <Select value={draft.verbosity} onValueChange={(value) => updateDraft('verbosity', value as CEOProfileDraft['verbosity'])}>
              <SelectTrigger className={cn('h-10', workspaceFieldClassName)}>
                <SelectValue>{VERBOSITY_LABELS[draft.verbosity]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="brief">精简</SelectItem>
                <SelectItem value="normal">中等</SelectItem>
                <SelectItem value="detailed">详细</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="升级风格" hint="遇到风险时是更激进提醒，还是更克制。">
            <Select value={draft.escalationStyle} onValueChange={(value) => updateDraft('escalationStyle', value as CEOProfileDraft['escalationStyle'])}>
              <SelectTrigger className={cn('h-10', workspaceFieldClassName)}>
                <SelectValue>{ESCALATION_LABELS[draft.escalationStyle]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aggressive">强提醒</SelectItem>
                <SelectItem value="balanced">平衡</SelectItem>
                <SelectItem value="minimal">克制</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="风险容忍度" hint="影响默认取舍语境。">
            <Select value={draft.riskTolerance} onValueChange={(value) => updateDraft('riskTolerance', value as CEOProfileDraft['riskTolerance'])}>
              <SelectTrigger className={cn('h-10', workspaceFieldClassName)}>
                <SelectValue>{RISK_LABELS[draft.riskTolerance]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">低</SelectItem>
                <SelectItem value="medium">中</SelectItem>
                <SelectItem value="high">高</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="评审偏好" hint="更关心结果、过程，还是折中。">
            <Select value={draft.reviewPreference} onValueChange={(value) => updateDraft('reviewPreference', value as CEOProfileDraft['reviewPreference'])}>
              <SelectTrigger className={cn('h-10', workspaceFieldClassName)}>
                <SelectValue>{REVIEW_LABELS[draft.reviewPreference]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="result-first">结果优先</SelectItem>
                <SelectItem value="process-first">过程优先</SelectItem>
                <SelectItem value="balanced">平衡</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleSaveProfile}
            disabled={!isDirty || saveState.status === 'saving'}
            className="rounded-full bg-[var(--app-accent)] px-4 text-white hover:brightness-105"
          >
            {saveState.status === 'saving' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            保存偏好
          </Button>
          <StatusMessage state={saveState} />
        </div>
      </SectionCard>

      <SectionCard
        title="反馈信号"
        description="把长期有效的协作偏好持续写入，帮助 AI 调整后续行为。"
        icon={<MessageSquareQuote className="h-4 w-4" />}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.36fr)_minmax(0,1fr)]">
          <FieldRow label="反馈类型" hint="用于后续区分偏好、纠偏、审批通过等。">
            <Select value={feedbackType} onValueChange={(value) => setFeedbackType(value as FeedbackType)}>
              <SelectTrigger className={cn('h-10', workspaceFieldClassName)}>
                <SelectValue>{FEEDBACK_TYPE_LABELS[feedbackType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preference">偏好调整</SelectItem>
                <SelectItem value="correction">纠偏</SelectItem>
                <SelectItem value="approval">认可</SelectItem>
                <SelectItem value="rejection">否决</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="反馈内容" hint="例如：汇报先给结果，再补过程。">
            <Textarea
              value={feedbackContent}
              onChange={(event) => setFeedbackContent(event.target.value)}
              placeholder="写入一条会长期保留的 CEO 行为反馈。"
              className={cn('min-h-24 rounded-2xl', workspaceFieldClassName)}
            />
          </FieldRow>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleAppendFeedback}
            disabled={!feedbackContent.trim() || feedbackState.status === 'saving'}
            className={cn('rounded-full px-4', workspaceOutlineActionClassName)}
          >
            {feedbackState.status === 'saving' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            提交反馈
          </Button>
          <StatusMessage state={feedbackState} />
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近反馈</div>
          {recentFeedback.length > 0 ? (
            <div className="space-y-2">
	              {recentFeedback.map((item) => (
                <div key={`${item.timestamp}:${item.content}`} className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                    <span>{FEEDBACK_TYPE_LABELS[item.type]}</span>
                    <span className="text-[var(--app-border-strong)]">•</span>
                    <span>{new Date(item.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--app-text-soft)]">{item.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-5 text-sm text-[var(--app-text-muted)]">
              还没有任何结构化反馈信号。
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

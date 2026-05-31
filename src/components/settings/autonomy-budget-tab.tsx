'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Activity, Layers, RefreshCw, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceBadge,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import type { CompanyLoopPolicyFE, OperatingBudgetPolicyFE } from '@/lib/types';
import { Card, SectionTitle, StackedField, SaveFeedback } from '@/components/settings/shared';

type CompanyLoopNotificationTarget = {
  channel: CompanyLoopPolicyFE['notificationChannels'][number];
  label: string;
  description: string;
  available: boolean;
  fixed?: boolean;
  reason?: string;
};

const ORGANIZATION_BUDGET_POLICY_ID = 'budget:organization:default:day';
const DEPARTMENT_DEFAULT_BUDGET_POLICY_ID = 'budget:department:default:day';
const ORGANIZATION_LOOP_POLICY_ID = 'company-loop-policy:organization:default';

function buildDefaultOrganizationBudgetPolicy(): OperatingBudgetPolicyFE {
  const now = new Date().toISOString();
  return {
    id: ORGANIZATION_BUDGET_POLICY_ID,
    scope: 'organization',
    period: 'day',
    maxTokens: 1_000_000,
    maxMinutes: 480,
    maxDispatches: 80,
    maxConcurrentRuns: 12,
    cooldownMinutesByKind: {
      'agenda.dispatch': 10,
    },
    failureBudget: {
      maxConsecutiveFailures: 3,
      coolDownMinutes: 30,
    },
    warningThreshold: 0.8,
    hardStop: true,
    createdAt: now,
    updatedAt: now,
    metadata: {
      highRiskApprovalThreshold: 0.7,
    },
  };
}

function buildDefaultDepartmentBudgetPolicy(): OperatingBudgetPolicyFE {
  const now = new Date().toISOString();
  return {
    id: DEPARTMENT_DEFAULT_BUDGET_POLICY_ID,
    scope: 'department',
    period: 'day',
    maxTokens: 250_000,
    maxMinutes: 120,
    maxDispatches: 20,
    maxConcurrentRuns: 3,
    cooldownMinutesByKind: {
      'manual.prompt': 0,
      'manual.template': 0,
      'agenda.dispatch': 10,
    },
    failureBudget: {
      maxConsecutiveFailures: 3,
      coolDownMinutes: 30,
    },
    warningThreshold: 0.8,
    hardStop: true,
    createdAt: now,
    updatedAt: now,
    metadata: {
      source: 'settings-department-default',
    },
  };
}

function buildDefaultCompanyLoopPolicy(): CompanyLoopPolicyFE {
  const now = new Date().toISOString();
  return {
    id: ORGANIZATION_LOOP_POLICY_ID,
    scope: 'organization',
    enabled: true,
    timezone: 'Asia/Shanghai',
    dailyReviewHour: 20,
    weeklyReviewDay: 5,
    weeklyReviewHour: 20,
    maxAgendaPerDailyLoop: 5,
    maxAutonomousDispatchesPerLoop: 1,
    allowedAgendaActions: ['observe', 'dispatch', 'snooze', 'dismiss'],
    notificationChannels: ['web'],
    createdAt: now,
    updatedAt: now,
  };
}

function cooldownToDraft(policy: OperatingBudgetPolicyFE): string {
  return Object.entries(policy.cooldownMinutesByKind || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, minutes]) => `${kind}=${minutes}`)
    .join('\n');
}

function draftToCooldown(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [rawKey, rawValue] = trimmed.split('=');
    const key = rawKey?.trim();
    const minutes = Number(rawValue?.trim());
    if (!key || Number.isNaN(minutes)) continue;
    result[key] = Math.max(0, Math.trunc(minutes));
  }
  return result;
}

export default function AutonomyBudgetTab() {
  const [policy, setPolicy] = useState<OperatingBudgetPolicyFE | null>(null);
  const [departmentPolicy, setDepartmentPolicy] = useState<OperatingBudgetPolicyFE | null>(null);
  const [loopPolicy, setLoopPolicy] = useState<CompanyLoopPolicyFE | null>(null);
  const [notificationTargets, setNotificationTargets] = useState<CompanyLoopNotificationTarget[]>([]);
  const [cooldownDraft, setCooldownDraft] = useState('');
  const [departmentCooldownDraft, setDepartmentCooldownDraft] = useState('');
  const [showOrgAdvanced, setShowOrgAdvanced] = useState(false);
  const [showDepartmentAdvanced, setShowDepartmentAdvanced] = useState(false);
  const [showLoopAdvanced, setShowLoopAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const [organizationRes, departmentRes, loopRes, notificationTargetsRes] = await Promise.all([
        fetch('/api/company/budget/policies?scope=organization&period=day&pageSize=1'),
        fetch(`/api/company/budget/policies/${encodeURIComponent(DEPARTMENT_DEFAULT_BUDGET_POLICY_ID)}`),
        fetch(`/api/company/loops/policies/${encodeURIComponent(ORGANIZATION_LOOP_POLICY_ID)}`),
        fetch('/api/company/loops/notification-targets'),
      ]);
      if (!organizationRes.ok) {
        const data = (await organizationRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to load autonomy policy');
      }
      const organizationData = (await organizationRes.json()) as { items?: OperatingBudgetPolicyFE[] };
      const nextPolicy = organizationData.items?.[0] || buildDefaultOrganizationBudgetPolicy();
      const nextDepartmentPolicy = departmentRes.ok
        ? (await departmentRes.json()) as OperatingBudgetPolicyFE
        : buildDefaultDepartmentBudgetPolicy();
      const nextLoopPolicy = loopRes.ok
        ? (await loopRes.json()) as CompanyLoopPolicyFE
        : buildDefaultCompanyLoopPolicy();
      const nextNotificationTargets = notificationTargetsRes.ok
        ? ((await notificationTargetsRes.json()) as { items?: CompanyLoopNotificationTarget[] }).items ?? []
        : [];
      setPolicy(nextPolicy);
      setDepartmentPolicy(nextDepartmentPolicy);
      setLoopPolicy(nextLoopPolicy);
      setNotificationTargets(nextNotificationTargets);
      setCooldownDraft(cooldownToDraft(nextPolicy));
      setDepartmentCooldownDraft(cooldownToDraft(nextDepartmentPolicy));
      setShowOrgAdvanced(false);
      setShowDepartmentAdvanced(false);
      setShowLoopAdvanced(false);
    } catch (err) {
      const fallback = buildDefaultOrganizationBudgetPolicy();
      const departmentFallback = buildDefaultDepartmentBudgetPolicy();
      setPolicy(fallback);
      setDepartmentPolicy(departmentFallback);
      setLoopPolicy(buildDefaultCompanyLoopPolicy());
      setNotificationTargets([
        {
          channel: 'web',
          label: 'Web 收件箱',
          description: '在 CEO / Web 界面保留公司循环摘要。',
          available: true,
          fixed: true,
        },
      ]);
      setCooldownDraft(cooldownToDraft(fallback));
      setDepartmentCooldownDraft(cooldownToDraft(departmentFallback));
      setShowOrgAdvanced(false);
      setShowDepartmentAdvanced(false);
      setShowLoopAdvanced(false);
      setSaveError(err instanceof Error ? err.message : 'Failed to load autonomy policy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const updateNumber = (
    target: 'organization' | 'department',
    field: keyof Pick<OperatingBudgetPolicyFE, 'maxTokens' | 'maxMinutes' | 'maxDispatches' | 'maxConcurrentRuns' | 'warningThreshold'>,
    value: string,
  ) => {
    const parsed = Number(value);
    const setter = target === 'organization' ? setPolicy : setDepartmentPolicy;
    setter((prev) => {
      if (!prev) return prev;
      if (field === 'warningThreshold') {
        return { ...prev, warningThreshold: Math.max(0, Math.min(1, parsed || 0)) };
      }
      return { ...prev, [field]: Math.max(0, Math.trunc(parsed || 0)) };
    });
  };

  const updateFailureBudget = (
    target: 'organization' | 'department',
    field: 'maxConsecutiveFailures' | 'coolDownMinutes',
    value: string,
  ) => {
    const parsed = Math.max(0, Math.trunc(Number(value) || 0));
    const setter = target === 'organization' ? setPolicy : setDepartmentPolicy;
    setter((prev) => prev ? {
      ...prev,
      failureBudget: {
        maxConsecutiveFailures: prev.failureBudget?.maxConsecutiveFailures ?? 3,
        coolDownMinutes: prev.failureBudget?.coolDownMinutes ?? 30,
        [field]: parsed,
      },
    } : prev);
  };

  const updateApprovalThreshold = (value: string) => {
    const parsed = Math.max(0, Math.min(1, Number(value) || 0));
    setPolicy((prev) => prev ? {
      ...prev,
      metadata: {
        ...(prev.metadata || {}),
        highRiskApprovalThreshold: parsed,
      },
    } : prev);
  };

  const updateLoopNumber = (
    field: keyof Pick<CompanyLoopPolicyFE, 'dailyReviewHour' | 'weeklyReviewDay' | 'weeklyReviewHour' | 'maxAgendaPerDailyLoop' | 'maxAutonomousDispatchesPerLoop'>,
    value: string,
  ) => {
    const parsed = Math.trunc(Number(value) || 0);
    setLoopPolicy((prev) => prev ? {
      ...prev,
      [field]: field === 'weeklyReviewDay'
        ? Math.max(0, Math.min(6, parsed))
        : field.endsWith('Hour')
          ? Math.max(0, Math.min(23, parsed))
          : Math.max(0, parsed),
    } : prev);
  };

  const handleSave = async () => {
    if (!policy || !departmentPolicy || !loopPolicy) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const nextPolicy: OperatingBudgetPolicyFE = {
        ...policy,
        id: policy.id || ORGANIZATION_BUDGET_POLICY_ID,
        scope: 'organization',
        period: 'day',
        cooldownMinutesByKind: draftToCooldown(cooldownDraft),
      };
      const nextDepartmentPolicy: OperatingBudgetPolicyFE = {
        ...departmentPolicy,
        id: departmentPolicy.id || DEPARTMENT_DEFAULT_BUDGET_POLICY_ID,
        scope: 'department',
        scopeId: undefined,
        period: 'day',
        cooldownMinutesByKind: draftToCooldown(departmentCooldownDraft),
      };
      const nextLoopPolicy: CompanyLoopPolicyFE = {
        ...loopPolicy,
        id: loopPolicy.id || ORGANIZATION_LOOP_POLICY_ID,
        scope: 'organization',
        notificationChannels: Array.from(new Set([
          'web',
          ...loopPolicy.notificationChannels.filter((channel) =>
            notificationTargets.some((target) => target.channel === channel && (target.fixed || target.available)),
          ),
        ])) as CompanyLoopPolicyFE['notificationChannels'],
      };
      const [organizationRes, departmentRes, loopRes] = await Promise.all([
        fetch(`/api/company/budget/policies/${encodeURIComponent(nextPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextPolicy),
        }),
        fetch(`/api/company/budget/policies/${encodeURIComponent(nextDepartmentPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextDepartmentPolicy),
        }),
        fetch(`/api/company/loops/policies/${encodeURIComponent(nextLoopPolicy.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextLoopPolicy),
        }),
      ]);
      if (!organizationRes.ok || !departmentRes.ok || !loopRes.ok) {
        const failed = !organizationRes.ok ? organizationRes : !departmentRes.ok ? departmentRes : loopRes;
        const data = (await failed.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Save failed');
      }
      const organizationData = (await organizationRes.json()) as { policy: OperatingBudgetPolicyFE };
      const departmentData = (await departmentRes.json()) as { policy: OperatingBudgetPolicyFE };
      const loopData = (await loopRes.json()) as { policy: CompanyLoopPolicyFE };
      setPolicy(organizationData.policy);
      setDepartmentPolicy(departmentData.policy);
      setLoopPolicy(loopData.policy);
      setCooldownDraft(cooldownToDraft(organizationData.policy));
      setDepartmentCooldownDraft(cooldownToDraft(departmentData.policy));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !policy || !departmentPolicy || !loopPolicy) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[var(--app-text-soft)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading autonomy policy…
      </div>
    );
  }

  const highRiskApprovalThreshold = Number(policy.metadata?.highRiskApprovalThreshold ?? 0.7);
  const organizationModeLabel = policy.hardStop ? '超限即停止' : '仅预警';
  const departmentModeLabel = departmentPolicy.hardStop ? '超限即停止' : '仅预警';
  const loopModeLabel = loopPolicy.enabled ? '已启用' : '已停用';
  const availableExternalTargets = notificationTargets.filter((target) => target.channel !== 'web' && target.available);

  return (
    <div className="space-y-5">
      <Card className="border-sky-400/15 bg-[linear-gradient(180deg,#ffffff,#f4f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Activity className="h-4 w-4" />}>组织自运营预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              控制公司级自治任务的预算边界。这里只配总量和风险阈值，不把内部 policy 标识暴露给使用者。
            </p>
          </div>
          <WorkspaceBadge tone={policy.hardStop ? 'warning' : 'info'}>{organizationModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StackedField label="Token 上限">
            <Input
              type="number"
              value={policy.maxTokens}
              onChange={(event) => updateNumber('organization', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="分钟上限">
            <Input
              type="number"
              value={policy.maxMinutes}
              onChange={(event) => updateNumber('organization', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="派发上限">
            <Input
              type="number"
              value={policy.maxDispatches}
              onChange={(event) => updateNumber('organization', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="并发上限">
            <Input
              type="number"
              value={policy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('organization', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StackedField label="连续失败">
              <Input
                type="number"
                value={policy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('organization', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="冷却分钟">
              <Input
                type="number"
                value={policy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('organization', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="预警阈值" hint="0 到 1">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={policy.warningThreshold}
                onChange={(event) => updateNumber('organization', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="审批阈值" hint="高于该值需要审批">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={highRiskApprovalThreshold}
                onChange={(event) => updateApprovalThreshold(event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
          </div>

          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">执行模式</div>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--app-text)]">
              <input
                type="checkbox"
                checked={policy.hardStop}
                onChange={(event) => setPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              超限后立即停止自治任务
            </label>
            <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
              关闭后只会预警，不会自动拦截。
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">operation 冷却规则属于高级项，默认不在主画面展开。</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowOrgAdvanced((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showOrgAdvanced ? '收起高级规则' : '展开高级规则'}
          </Button>
        </div>

        {showOrgAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="text-sm font-semibold text-[var(--app-text)]">操作冷却</div>
            <textarea
              value={cooldownDraft}
              onChange={(event) => setCooldownDraft(event.target.value)}
              spellCheck={false}
              className={cn('mt-3 min-h-[160px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
              placeholder={'agenda.dispatch=10'}
            />
            <p className="mt-3 text-xs leading-6 text-[var(--app-text-soft)]">
              每行一个 `operationKind=minutes`。只在你明确要限制某类自治动作冷却时才需要填写。
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="border-emerald-400/15 bg-[linear-gradient(180deg,#ffffff,#f5fbf8)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Layers className="h-4 w-4" />}>部门默认预算</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              新部门或未配置专属预算的部门会继承这组默认值。大多数情况下只需要改总量和拦截模式。
            </p>
          </div>
          <WorkspaceBadge tone={departmentPolicy.hardStop ? 'warning' : 'info'}>{departmentModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StackedField label="Token 上限">
            <Input
              type="number"
              value={departmentPolicy.maxTokens}
              onChange={(event) => updateNumber('department', 'maxTokens', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="分钟上限">
            <Input
              type="number"
              value={departmentPolicy.maxMinutes}
              onChange={(event) => updateNumber('department', 'maxMinutes', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="派发上限">
            <Input
              type="number"
              value={departmentPolicy.maxDispatches}
              onChange={(event) => updateNumber('department', 'maxDispatches', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="并发上限">
            <Input
              type="number"
              value={departmentPolicy.maxConcurrentRuns ?? 0}
              onChange={(event) => updateNumber('department', 'maxConcurrentRuns', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StackedField label="连续失败">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.maxConsecutiveFailures ?? 3}
                onChange={(event) => updateFailureBudget('department', 'maxConsecutiveFailures', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="冷却分钟">
              <Input
                type="number"
                value={departmentPolicy.failureBudget?.coolDownMinutes ?? 30}
                onChange={(event) => updateFailureBudget('department', 'coolDownMinutes', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
            <StackedField label="预警阈值" hint="0 到 1">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={departmentPolicy.warningThreshold}
                onChange={(event) => updateNumber('department', 'warningThreshold', event.target.value)}
                className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
              />
            </StackedField>
          </div>
          <div className="rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">执行模式</div>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--app-text)]">
              <input
                type="checkbox"
                checked={departmentPolicy.hardStop}
                onChange={(event) => setDepartmentPolicy((prev) => prev ? { ...prev, hardStop: event.target.checked } : prev)}
              />
              部门超限后立即停止自治任务
            </label>
            <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
              默认部门策略尽量保持简单，新部门直接继承，不必在这里做功能级拆分。
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">部门冷却规则属于高级项，只在确实需要压某类动作时再展开。</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowDepartmentAdvanced((value) => !value)}
            className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
          >
            {showDepartmentAdvanced ? '收起高级规则' : '展开高级规则'}
          </Button>
        </div>

        {showDepartmentAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="text-sm font-semibold text-[var(--app-text)]">部门冷却规则</div>
            <textarea
              value={departmentCooldownDraft}
              onChange={(event) => setDepartmentCooldownDraft(event.target.value)}
              spellCheck={false}
              className={cn('mt-3 min-h-[140px] w-full resize-y rounded-2xl border px-4 py-3 font-mono text-xs leading-6 outline-none', workspaceFieldClassName)}
              placeholder={'manual.prompt=0\nmanual.template=0\nagenda.dispatch=10'}
            />
            <p className="mt-3 text-xs leading-6 text-[var(--app-text-soft)]">
              每行一个 `operationKind=minutes`。比如限制 `agenda.dispatch` 重复派发，或把 `manual.prompt` 保持为 0。
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="border-blue-400/15 bg-[linear-gradient(180deg,#ffffff,#f5f8ff)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<RefreshCw className="h-4 w-4" />}>公司循环策略</SectionTitle>
            <p className="max-w-2xl text-xs leading-6 text-[var(--app-text-soft)]">
              控制 daily / weekly review 的触发节奏和允许的自治动作。默认只显示主节奏，高级选项按需展开。
            </p>
          </div>
          <WorkspaceBadge tone={loopPolicy.enabled ? 'success' : 'neutral'}>{loopModeLabel}</WorkspaceBadge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StackedField label="时区">
            <Input
              value={loopPolicy.timezone}
              onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, timezone: event.target.value } : prev)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="日报小时">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.dailyReviewHour}
              onChange={(event) => updateLoopNumber('dailyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="周报星期">
            <Input
              type="number"
              min="0"
              max="6"
              value={loopPolicy.weeklyReviewDay}
              onChange={(event) => updateLoopNumber('weeklyReviewDay', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="周报小时">
            <Input
              type="number"
              min="0"
              max="23"
              value={loopPolicy.weeklyReviewHour}
              onChange={(event) => updateLoopNumber('weeklyReviewHour', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="每日议程数">
            <Input
              type="number"
              value={loopPolicy.maxAgendaPerDailyLoop}
              onChange={(event) => updateLoopNumber('maxAgendaPerDailyLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
          <StackedField label="单次派发上限">
            <Input
              type="number"
              value={loopPolicy.maxAutonomousDispatchesPerLoop}
              onChange={(event) => updateLoopNumber('maxAutonomousDispatchesPerLoop', event.target.value)}
              className={cn('h-9 rounded-lg text-xs', workspaceFieldClassName)}
            />
          </StackedField>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3">
          <div className="text-xs text-[var(--app-text-soft)]">是否启用、允许哪些动作、摘要投递到哪里，都属于高级项。</div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
              <input
                type="checkbox"
                checked={loopPolicy.enabled}
                onChange={(event) => setLoopPolicy((prev) => prev ? { ...prev, enabled: event.target.checked } : prev)}
              />
              启用公司循环
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowLoopAdvanced((value) => !value)}
              className={cn('rounded-full text-xs', workspaceOutlineActionClassName)}
            >
              {showLoopAdvanced ? '收起高级规则' : '展开高级规则'}
            </Button>
          </div>
        </div>

        {showLoopAdvanced ? (
          <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4">
            <div className="flex flex-wrap gap-3 text-xs text-[var(--app-text-soft)]">
              {(['observe', 'dispatch', 'approve', 'snooze', 'dismiss'] as CompanyLoopPolicyFE['allowedAgendaActions']).map((action) => (
                <label key={action} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loopPolicy.allowedAgendaActions.includes(action)}
                    onChange={(event) => setLoopPolicy((prev) => {
                      if (!prev) return prev;
                      const nextActions = event.target.checked
                        ? Array.from(new Set([...prev.allowedAgendaActions, action]))
                        : prev.allowedAgendaActions.filter((item) => item !== action);
                      return { ...prev, allowedAgendaActions: nextActions };
                    })}
                  />
                  {action}
                </label>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">摘要投递</div>
              <div className="mt-2 text-xs leading-6 text-[var(--app-text-soft)]">
                会话平台负责对话入口；这里控制公司循环摘要往哪里投递。
              </div>
              <div className="mt-3 space-y-2">
                {notificationTargets.map((target) => {
                  const checked = target.fixed || (target.available && loopPolicy.notificationChannels.includes(target.channel));
                  const disabled = target.fixed || !target.available;
                  return (
                    <label
                      key={target.channel}
                      className={cn(
                        'flex items-start justify-between gap-3 rounded-xl border px-3 py-3',
                        target.available
                          ? 'border-[var(--app-border-soft)] bg-[var(--app-surface)]'
                          : 'border-[var(--app-border-soft)] bg-[var(--app-surface)] opacity-70',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--app-text)]">{target.label}</div>
                        <div className="mt-1 text-xs leading-5 text-[var(--app-text-soft)]">
                          {target.available ? target.description : target.reason || target.description}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <WorkspaceBadge tone={target.fixed ? 'success' : target.available ? 'info' : 'neutral'}>
                          {target.fixed ? '默认启用' : target.available ? '可用' : '未接入'}
                        </WorkspaceBadge>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => setLoopPolicy((prev) => {
                            if (!prev || target.fixed || !target.available) return prev;
                            const nextChannels = event.target.checked
                              ? Array.from(new Set([...prev.notificationChannels, target.channel]))
                              : prev.notificationChannels.filter((item) => item !== target.channel);
                            return { ...prev, notificationChannels: nextChannels };
                          })}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              {availableExternalTargets.length === 0 ? (
                <div className="mt-3 text-xs text-[var(--app-text-soft)]">
                  当前只有 Web 收件箱会接收公司循环摘要；外部投递尚未接入。
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 px-4 font-medium text-white hover:bg-sky-400"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存自运营策略
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void loadPolicy()}
          className={cn('text-xs', workspaceOutlineActionClassName)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          重新加载
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { NativeSelect } from '@/components/ui/native-select';
import type { DepartmentConfig, DepartmentOKR, DepartmentRoster, Skill, TokenQuota, TemplateSummaryFE, Workflow } from '@/lib/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DepartmentSetupDialogProps {
  workspaceUri: string;
  workspaceName: string;
  initialConfig: DepartmentConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (config: DepartmentConfig) => void;
}

// ─── Preset types ───────────────────────────────────────────────────────────

const PRESET_TYPES: Array<{ value: string; icon: string; label: string; desc: string }> = [
  { value: 'build', icon: '🔧', label: 'Build', desc: '产研/开发' },
  { value: 'research', icon: '🔬', label: 'Research', desc: '调研/分析' },
  { value: 'operations', icon: '⚙️', label: 'Operations', desc: '运营/运维' },
  { value: 'ceo', icon: '👔', label: 'CEO Office', desc: 'CEO 专属房间' },
];

// Available character sprite types for roster
const SPRITE_OPTIONS: Array<{ value: string; label: string; preview?: string }> = [
  { value: '', label: '自动' },
  // Centcom (animated)
  { value: 'cc_codemaster', label: '🎮 Codemaster', preview: '/office/centcom/codemaster-talk.png' },
  { value: 'cc_nova', label: '🌟 Nova', preview: '/office/centcom/nova-talk.png' },
  { value: 'cc_ralph', label: '👨‍💼 Ralph', preview: '/office/centcom/ralph-talk.png' },
  { value: 'cc_rook', label: '🏰 Rook', preview: '/office/centcom/rook-talk.png' },
  // RPG (animated)
  { value: 'rpg_dev', label: '💻 RPG 开发者', preview: '/office/rpg/agent-dev-walk-down.png' },
  { value: 'rpg_tech', label: '🔧 RPG 技术员', preview: '/office/rpg/agent-tech-walk-down.png' },
  { value: 'rpg_admin', label: '📋 RPG 管理员', preview: '/office/rpg/agent-admin-walk-down.png' },
  { value: 'rpg_boss', label: '👔 RPG Boss', preview: '/office/rpg/agent-boss-walk-down.png' },
  { value: 'rpg_marketing', label: '📣 RPG 市场', preview: '/office/rpg/agent-marketing-walk-down.png' },
  { value: 'rpg_listing', label: '📝 RPG 文员', preview: '/office/rpg/agent-listing-walk-down.png' },
  // Piraminet pixel characters (static)
  { value: 'rpg_char_0', label: '🧑 像素角色 0', preview: '/office/rpg/char_0.png' },
  { value: 'rpg_char_1', label: '🧑 像素角色 1', preview: '/office/rpg/char_1.png' },
  { value: 'rpg_char_2', label: '🧑 像素角色 2', preview: '/office/rpg/char_2.png' },
  { value: 'rpg_char_3', label: '🧑 像素角色 3', preview: '/office/rpg/char_3.png' },
  { value: 'rpg_char_4', label: '🧑 像素角色 4', preview: '/office/rpg/char_4.png' },
  { value: 'rpg_char_5', label: '🧑 像素角色 5', preview: '/office/rpg/char_5.png' },
  // Guest sprites
  { value: 'guest_1', label: '👤 访客 1', preview: '/office/guest_role_1.png' },
  { value: 'guest_2', label: '👤 访客 2', preview: '/office/guest_role_2.png' },
  { value: 'guest_3', label: '👤 访客 3', preview: '/office/guest_role_3.png' },
  { value: 'guest_4', label: '👤 访客 4', preview: '/office/guest_role_4.png' },
  { value: 'guest_5', label: '👤 访客 5', preview: '/office/guest_role_5.png' },
  { value: 'guest_6', label: '👤 访客 6', preview: '/office/guest_role_6.png' },
  // Static RPG workers
  { value: 'rpg_worker1', label: '🧑‍💼 RPG 员工 1', preview: '/office/rpg/worker1.png' },
  { value: 'rpg_worker2', label: '🧑‍💼 RPG 员工 2', preview: '/office/rpg/worker2.png' },
  { value: 'rpg_worker4', label: '🧑‍💼 RPG 员工 4', preview: '/office/rpg/worker4.png' },
  { value: 'rpg_julia', label: '👩 Julia', preview: '/office/rpg/Julia-Idle.png' },
];

// ─── Sprite visual picker ────────────────────────────────────────────────

function SpritePicker({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const selected = SPRITE_OPTIONS.find(o => o.value === value) ?? SPRITE_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer w-full"
      >
        {selected.preview && (
          <img src={selected.preview} alt="" className="w-6 h-6 object-contain" style={{ imageRendering: 'pixelated' }} />
        )}
        <span className="truncate flex-1 text-left">{selected.label}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg p-2 max-h-48 overflow-y-auto">
          <div className="grid grid-cols-5 gap-1">
            {SPRITE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value || undefined); setOpen(false); }}
                title={opt.label}
                className={`flex flex-col items-center gap-0.5 p-1.5 rounded cursor-pointer transition-colors ${
                  value === opt.value ? 'bg-indigo-500/20 ring-1 ring-indigo-500' : 'hover:bg-muted'
                }`}
              >
                {opt.preview ? (
                  <img src={opt.preview} alt="" className="w-8 h-8 object-contain" style={{ imageRendering: 'pixelated' }} />
                ) : (
                  <div className="w-8 h-8 flex items-center justify-center text-muted-foreground text-lg">⚡</div>
                )}
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">{opt.label.replace(/^[^\s]+ /, '')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeWorkflowRef(workflowRef?: string): string {
  const trimmed = workflowRef?.trim() || '';
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function splitSkillRefs(raw: string): string[] {
  return raw
    .split(',')
    .map(ref => ref.trim())
    .filter(Boolean);
}

function formatSkillRefs(skillRefs?: string[]): string {
  return (skillRefs ?? []).join(', ');
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DepartmentSetupDialog({
  workspaceUri,
  workspaceName,
  initialConfig,
  open,
  onOpenChange,
  onSaved,
}: DepartmentSetupDialogProps) {
  const [name, setName] = useState(initialConfig.name);
  const [type, setType] = useState(initialConfig.type);
  const [typeIcon, setTypeIcon] = useState(initialConfig.typeIcon ?? '');
  const [description, setDescription] = useState(initialConfig.description ?? '');
  const [customType, setCustomType] = useState(
    PRESET_TYPES.some(p => p.value === initialConfig.type) ? '' : initialConfig.type,
  );
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(initialConfig.templateIds ?? []);
  const [okr, setOkr] = useState<DepartmentOKR | null>(initialConfig.okr ?? null);
  const [roster, setRoster] = useState<DepartmentRoster[]>(initialConfig.roster ?? []);
  const [skills, setSkills] = useState(initialConfig.skills ?? []);
  const [provider, setProvider] = useState<DepartmentConfig['provider']>(initialConfig.provider);
  const [tokenQuotaDaily, setTokenQuotaDaily] = useState<number>(initialConfig.tokenQuota?.daily ?? 0);
  const [tokenQuotaMonthly, setTokenQuotaMonthly] = useState<number>(initialConfig.tokenQuota?.monthly ?? 0);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummaryFE[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [canonicalWorkflows, setCanonicalWorkflows] = useState<Workflow[]>([]);
  const [canonicalSkills, setCanonicalSkills] = useState<Skill[]>([]);
  const workflowOptions = useMemo(
    () => canonicalWorkflows.map(workflow => ({
      value: `/${workflow.name}`,
      label: `/${workflow.name}`,
      description: workflow.description,
    })),
    [canonicalWorkflows],
  );
  const canonicalSkillRefs = useMemo(
    () => canonicalSkills.map(skill => skill.name),
    [canonicalSkills],
  );

  const isCustomType = !PRESET_TYPES.some(p => p.value === type);
  const skillSummary = useMemo(() => {
    const total = skills.length;
    const withWorkflow = skills.filter(skill => normalizeWorkflowRef(skill.workflowRef)).length;
    const withFallback = skills.filter(skill => (skill.skillRefs ?? []).some(ref => ref.trim())).length;
    return { total, withWorkflow, withFallback };
  }, [skills]);

  // ── Derived: all roleIds from selected templates ────────────────────────

  const allRoleIds = useMemo(() => {
      const ids = new Set<string>();
      for (const tpl of templates) {
        if (selectedTemplateIds.includes(tpl.id)) {
          for (const g of Object.values(tpl.stages)) {
            for (const rid of g.roleIds ?? []) ids.add(rid);
          }
        }
    }
    return Array.from(ids);
  }, [templates, selectedTemplateIds]);

  useEffect(() => {
    if (open) {
      setName(initialConfig.name);
      setType(initialConfig.type);
      setTypeIcon(initialConfig.typeIcon ?? '');
      setDescription(initialConfig.description ?? '');
      setCustomType(PRESET_TYPES.some(p => p.value === initialConfig.type) ? '' : initialConfig.type);
      setSelectedTemplateIds(initialConfig.templateIds ?? []);
      setOkr(initialConfig.okr ?? null);
      setRoster(initialConfig.roster ?? []);
      setSkills(initialConfig.skills ?? []);
      setProvider(initialConfig.provider);
      setTokenQuotaDaily(initialConfig.tokenQuota?.daily ?? 0);
      setTokenQuotaMonthly(initialConfig.tokenQuota?.monthly ?? 0);
    }
  }, [open, initialConfig]);

  // ── Load templates ─────────────────────────────────────────────────

  useEffect(() => {
    if (open && (templates.length === 0 || canonicalWorkflows.length === 0 || canonicalSkills.length === 0)) {
      setTemplatesLoading(true);
      Promise.all([
        api.pipelines().then(setTemplates),
        api.workflows().then(setCanonicalWorkflows).catch(() => {}),
        api.skills().then(setCanonicalSkills).catch(() => {}),
      ])
        .catch(() => {})
        .finally(() => setTemplatesLoading(false));
    }
  }, [canonicalSkills.length, canonicalWorkflows.length, open, templates.length]);

  // ── Template toggle ────────────────────────────────────────────────

  function toggleTemplate(id: string) {
    setSelectedTemplateIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  // ── OKR helpers ────────────────────────────────────────────────────────

  function ensureOkr(): DepartmentOKR {
    const base = okr ?? { period: '2026-Q1', objectives: [] };
    if (!okr) setOkr(base);
    return base;
  }

  function updateOkrPeriod(period: string) {
    setOkr(prev => ({ ...(prev ?? { objectives: [] }), period }));
  }

  function addObjective() {
    setOkr(prev => {
      const base = prev ?? { period: '2026-Q1', objectives: [] };
      return { ...base, objectives: [...base.objectives, { title: '', keyResults: [] }] };
    });
  }

  function updateObjectiveTitle(oi: number, title: string) {
    setOkr(prev => {
      if (!prev) return prev;
      return { ...prev, objectives: prev.objectives.map((o, idx) => (idx === oi ? { ...o, title } : o)) };
    });
  }

  function removeObjective(oi: number) {
    setOkr(prev => {
      if (!prev) return prev;
      return { ...prev, objectives: prev.objectives.filter((_, idx) => idx !== oi) };
    });
  }

  function addKR(oi: number) {
    setOkr(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        objectives: prev.objectives.map((o, idx) =>
          idx === oi
            ? { ...o, keyResults: [...o.keyResults, { description: '', target: 100, current: 0 }] }
            : o,
        ),
      };
    });
  }

  function updateKR(oi: number, ki: number, patch: Partial<DepartmentOKR['objectives'][0]['keyResults'][0]>) {
    setOkr(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        objectives: prev.objectives.map((o, oidx) =>
          oidx === oi
            ? { ...o, keyResults: o.keyResults.map((kr, kidx) => (kidx === ki ? { ...kr, ...patch } : kr)) }
            : o,
        ),
      };
    });
  }

  function removeKR(oi: number, ki: number) {
    setOkr(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        objectives: prev.objectives.map((o, oidx) =>
          oidx === oi ? { ...o, keyResults: o.keyResults.filter((_, kidx) => kidx !== ki) } : o,
        ),
      };
    });
  }

  // ── Roster helpers ─────────────────────────────────────────────────────

  function updateRosterEntry(roleId: string, patch: Partial<DepartmentRoster>) {
    setRoster(prev => {
      const existing = prev.find(r => r.rolePattern === roleId);
      if (existing) {
        return prev.map(r => r.rolePattern === roleId ? { ...r, ...patch } : r);
      }
      return [...prev, { rolePattern: roleId, displayName: patch.displayName ?? '', title: patch.title, spriteType: patch.spriteType }];
    });
  }

  function getRosterEntry(roleId: string): DepartmentRoster | undefined {
    return roster.find(r => r.rolePattern === roleId);
  }

  function updateSkillAt(index: number, patch: Partial<DepartmentConfig['skills'][0]>) {
    setSkills(prev => prev.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)));
  }

  function toggleFallbackSkill(index: number, ref: string) {
    const normalized = ref.trim();
    if (!normalized) return;

    setSkills(prev => prev.map((skill, i) => {
      if (i !== index) return skill;
      const nextRefs = new Set((skill.skillRefs ?? []).map(item => item.trim()).filter(Boolean));
      if (nextRefs.has(normalized)) {
        nextRefs.delete(normalized);
      } else {
        nextRefs.add(normalized);
      }
      return { ...skill, skillRefs: Array.from(nextRefs) };
    }));
  }

  function addSkill() {
    setSkills(prev => [
      ...prev,
      {
        skillId: `skill_${Date.now()}`,
        name: '',
        category: 'operations',
        workflowRef: undefined,
        skillRefs: [],
      },
    ]);
  }

  function removeSkill(index: number) {
    setSkills(prev => prev.filter((_, i) => i !== index));
  }

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const resolvedType = isCustomType ? customType.trim() || 'build' : type;
      const resolvedIcon = typeIcon.trim() || PRESET_TYPES.find(p => p.value === resolvedType)?.icon || '';
      // Build tokenQuota object if any quota value is set
      const tokenQuota: TokenQuota | null = (tokenQuotaDaily > 0 || tokenQuotaMonthly > 0)
        ? {
            daily: tokenQuotaDaily,
            monthly: tokenQuotaMonthly,
            used: initialConfig.tokenQuota?.used ?? { daily: 0, monthly: 0 },
            canRequestMore: initialConfig.tokenQuota?.canRequestMore ?? true,
          }
        : null;

      const config: DepartmentConfig = {
        name: name.trim() || workspaceName,
        type: resolvedType,
        ...(resolvedIcon ? { typeIcon: resolvedIcon } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(selectedTemplateIds.length > 0 ? { templateIds: selectedTemplateIds } : {}),
        skills: skills
          .filter(skill => skill.name.trim())
          .map(skill => ({
            ...skill,
            workflowRef: normalizeWorkflowRef(skill.workflowRef) || undefined,
            skillRefs: Array.from(new Set((skill.skillRefs ?? []).flatMap(splitSkillRefs))).filter(Boolean),
          })),
        okr: okr && okr.objectives.length > 0 ? okr : null,
        roster: roster.filter(r => r.rolePattern.trim() && (r.displayName.trim() || r.spriteType)),
        ...(provider ? { provider } : {}),
        ...(tokenQuota ? { tokenQuota } : {}),
        // Preserve map editor data (roomLayout/roomBg) — these are managed by RoomEditor, not this dialog
        ...(initialConfig.roomLayout?.length ? { roomLayout: initialConfig.roomLayout } : {}),
        ...(initialConfig.roomBg ? { roomBg: initialConfig.roomBg } : {}),
      };
      await api.updateDepartment(workspaceUri, config);
      // Auto-sync rules after saving so they take effect immediately
      try {
        await api.syncDepartment(workspaceUri);
      } catch {
        // Sync failure is non-fatal — config is already saved
      }
      onSaved(config);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  const resolvedIcon = typeIcon || PRESET_TYPES.find(p => p.value === type)?.icon || '🏢';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl h-[70vh] flex flex-col p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="text-xl">{resolvedIcon}</span>
              配置部门
            </DialogTitle>
            <DialogDescription className="text-xs truncate">
              {workspaceUri}
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs defaultValue="basic" className="px-6 flex flex-col min-h-0 flex-1">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="basic" className="text-xs">基本信息</TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">
              模板{selectedTemplateIds.length > 0 && ` (${selectedTemplateIds.length})`}
            </TabsTrigger>
            <TabsTrigger value="skills" className="text-xs">
              技能{skills.length > 0 && ` (${skills.length})`}
            </TabsTrigger>
            <TabsTrigger value="roster" className="text-xs">花名册</TabsTrigger>
            <TabsTrigger value="okr" className="text-xs">OKR</TabsTrigger>
          </TabsList>

          {/* ── Basic Tab ─────────────────────────────────────────────── */}
          <TabsContent value="basic" className="space-y-5 pt-4 pb-2 overflow-y-auto">
            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="dept-name" className="text-sm font-medium text-foreground">部门名称</label>
              <Input
                id="dept-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={workspaceName}
                className="h-9"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="dept-desc" className="text-sm font-medium text-foreground">部门定位</label>
              <textarea
                id="dept-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="简要介绍部门职责和定位。例如：负责核心业务系统开发，包含前后端和移动端…"
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
              <p className="text-xs text-muted-foreground">
                CEO 下达指令时，会根据部门定位来匹配最合适的部门
              </p>
            </div>

            {/* Type */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">部门类型</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="部门类型">
                {PRESET_TYPES.map(p => {
                  const selected = type === p.value && !isCustomType;
                  return (
                    <button
                      type="button"
                      key={p.value}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => { setType(p.value); setCustomType(''); setTypeIcon(p.icon); }}
                      className={`rounded-lg border px-3 py-3 text-left transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        selected
                          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
                          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className="text-sm font-medium">{p.icon} {p.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  className="flex-1 h-9 text-xs"
                  value={customType}
                  onChange={e => { setCustomType(e.target.value); setType(e.target.value || 'build'); }}
                  placeholder="或输入自定义类型…"
                  aria-label="自定义部门类型"
                />
                <Input
                  className="w-14 h-9 text-center text-base"
                  value={typeIcon}
                  onChange={e => setTypeIcon(e.target.value)}
                  placeholder="📌"
                  maxLength={2}
                  aria-label="部门图标"
                />
              </div>
            </div>

            {/* Provider */}
            <div className="space-y-1.5">
              <label htmlFor="dept-provider" className="text-sm font-medium text-foreground">AI Provider</label>
              <NativeSelect
                id="dept-provider"
                value={provider ?? 'auto'}
                onChange={(e) => setProvider(e.target.value === 'auto' ? undefined : e.target.value as DepartmentConfig['provider'])}
                size="sm"
                className="text-xs"
              >
                <option value="auto">自动选择</option>
                <option value="antigravity">Antigravity (gRPC)</option>
                <option value="codex">Codex (MCP)</option>
                <option value="native-codex">Codex Native (OAuth)</option>
                <option value="claude-code">Claude Code (CLI)</option>
                <option value="claude-api">Claude API (直连)</option>
                <option value="openai-api">OpenAI API</option>
                <option value="gemini-api">Gemini API</option>
                <option value="grok-api">Grok API</option>
                <option value="custom">OpenAI Compatible / Custom</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                设置该部门 Agent 任务使用的 AI 服务商
              </p>
            </div>

            {/* Token Quota */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Token 配额</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="quota-daily" className="text-xs text-muted-foreground">每日限额</label>
                  <Input
                    id="quota-daily"
                    type="number"
                    min={0}
                    step={10000}
                    value={tokenQuotaDaily || ''}
                    onChange={e => setTokenQuotaDaily(Math.max(0, Number(e.target.value)))}
                    placeholder="0 = 不限"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="quota-monthly" className="text-xs text-muted-foreground">每月限额</label>
                  <Input
                    id="quota-monthly"
                    type="number"
                    min={0}
                    step={100000}
                    value={tokenQuotaMonthly || ''}
                    onChange={e => setTokenQuotaMonthly(Math.max(0, Number(e.target.value)))}
                    placeholder="0 = 不限"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              {initialConfig.tokenQuota?.used && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>今日已用: {initialConfig.tokenQuota.used.daily.toLocaleString()}</span>
                  <span>本月已用: {initialConfig.tokenQuota.used.monthly.toLocaleString()}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                设置为 0 表示不限制。超出配额后将触发审批。
              </p>
            </div>
          </TabsContent>

          {/* ── Skills Tab ─────────────────────────────────────────────── */}
          <TabsContent value="skills" className="space-y-4 pt-4 pb-2 overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                部门 skill 是任务入口。优先绑定全局 workflow；没有 workflow 时再回退 skill refs。
              </p>
              <Button type="button" size="sm" variant="outline" onClick={addSkill}>
                + 添加技能
              </Button>
            </div>

            <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-3">
              <div>技能数：<span className="text-foreground font-medium">{skillSummary.total}</span></div>
              <div>绑定 Workflow：<span className="text-foreground font-medium">{skillSummary.withWorkflow}</span></div>
              <div>Fallback 列表：<span className="text-foreground font-medium">{skillSummary.withFallback}</span></div>
            </div>

            {skills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                暂无技能定义。可以先保存部门，后续再补 skill → workflow 映射。
              </div>
            ) : (
              <div className="space-y-3">
                {skills.map((skill, index) => (
                  <div key={skill.skillId || `${skill.name}-${index}`} className="rounded-lg border border-border/60 p-4 bg-muted/20 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">技能 {index + 1}</div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeSkill(index)}>
                        删除
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">技能名称</label>
                        <Input
                          value={skill.name}
                          onChange={e => updateSkillAt(index, { name: e.target.value })}
                          placeholder="如：日报总结"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">分类</label>
                        <Input
                          value={skill.category}
                          onChange={e => updateSkillAt(index, { category: e.target.value })}
                          placeholder="research / operations / engineering"
                          className="h-8"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">优先 Workflow</label>
                        <NativeSelect
                          value={skill.workflowRef || ''}
                          onChange={e => updateSkillAt(index, { workflowRef: e.target.value || undefined })}
                          className="text-xs"
                        >
                          <option value="">未绑定</option>
                          {workflowOptions.map(workflow => (
                            <option key={workflow.value} value={workflow.value} title={workflow.description}>
                              {workflow.label}
                            </option>
                          ))}
                        </NativeSelect>
                        <p className="text-[11px] text-muted-foreground">
                          选择后会优先尝试该 workflow；留空则让 provider 根据上下文自行决定。
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">Fallback Skills</label>
                        <Input
                          value={formatSkillRefs(skill.skillRefs)}
                          onChange={e => updateSkillAt(index, {
                            skillRefs: splitSkillRefs(e.target.value),
                          })}
                          placeholder={canonicalSkills.slice(0, 3).map(entry => entry.name).join(', ')}
                          className="h-8"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          支持 skill 名称或 skillId，逗号分隔。
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {canonicalSkillRefs.length > 0 ? canonicalSkillRefs.map(ref => {
                          const selected = (skill.skillRefs ?? []).includes(ref);
                          return (
                            <button
                              key={ref}
                              type="button"
                              onClick={() => toggleFallbackSkill(index, ref)}
                              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
                                selected
                                  ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
                                  : 'border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/40'
                              }`}
                              aria-pressed={selected}
                              title={`切换 fallback: ${ref}`}
                            >
                              {ref}
                            </button>
                          );
                        }) : (
                          <span className="text-[11px] text-muted-foreground">
                            暂无 canonical skills 可选，直接手动输入 fallback refs 即可。
                          </span>
                        )}
                      </div>
                      {(skill.skillRefs?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {skill.skillRefs?.map(ref => (
                            <span
                              key={ref}
                              className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/60"
                              title={ref}
                            >
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Templates Tab ─────────────────────────────────────────── */}
          <TabsContent value="templates" className="space-y-3 pt-4 pb-2 overflow-y-auto">
            <p className="text-xs text-muted-foreground leading-relaxed">
              选择该部门使用的流水线模板。选中模板后，其包含的角色会出现在「花名册」中。
            </p>
            {templatesLoading && (
              <p className="text-xs text-muted-foreground py-4 text-center">加载模板…</p>
            )}
            {!templatesLoading && templates.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">暂无可用模板</p>
            )}
            {templates.map(tpl => {
              const selected = selectedTemplateIds.includes(tpl.id);
              const roleIds = Object.values(tpl.stages).flatMap(g => g.roleIds ?? []);
              const uniqueRoles = [...new Set(roleIds)];
              return (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() => toggleTemplate(tpl.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    selected
                      ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
                      : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
                  }`}
                  aria-pressed={selected}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-4 h-4 rounded border text-center leading-4 text-[10px] ${
                      selected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-muted-foreground/40'
                    }`}>
                      {selected ? '✓' : ''}
                    </span>
                    <span className="text-sm font-medium">{tpl.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{tpl.id}</span>
                  </div>
                  {uniqueRoles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pl-6">
                      {uniqueRoles.map(r => (
                        <span key={r} className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </TabsContent>

          {/* ── Roster Tab ────────────────────────────────────────────── */}
          <TabsContent value="roster" className="space-y-3 pt-4 pb-2 overflow-y-auto">
            <p className="text-xs text-muted-foreground leading-relaxed">
              为角色指定名字和形象。通过模板自动获取角色，或手动添加。
            </p>

            {/* Manual roster entries (not from templates) */}
            {roster.map((entry, ri) => {
              if (allRoleIds.includes(entry.rolePattern)) return null;
              return (
              <div key={`manual-${ri}`} className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-2">
                <div className="flex gap-2 items-center">
                  <Input
                    className="w-40 h-9 text-xs font-mono"
                    value={entry.rolePattern}
                    onChange={e => {
                      setRoster(prev => prev.map((r, i) => i === ri ? { ...r, rolePattern: e.target.value } : r));
                    }}
                    placeholder="角色 ID"
                    aria-label="角色 ID"
                  />
                  <Input
                    className="flex-1 h-9 text-xs"
                    value={entry.displayName ?? ''}
                    onChange={e => {
                      setRoster(prev => prev.map((r, i) => i === ri ? { ...r, displayName: e.target.value } : r));
                    }}
                    placeholder="名字"
                    aria-label="名字"
                  />
                  <button
                    type="button"
                    className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-destructive rounded-md cursor-pointer"
                    onClick={() => setRoster(prev => prev.filter((_, i) => i !== ri))}
                    aria-label="删除"
                  >×</button>
                </div>
                <div className="flex gap-2 items-center">
                  <Input
                    className="w-28 h-8 text-xs"
                    value={entry.title ?? ''}
                    onChange={e => {
                      setRoster(prev => prev.map((r, i) => i === ri ? { ...r, title: e.target.value } : r));
                    }}
                    placeholder="职称（可选）"
                    aria-label="职称"
                  />
                  <SpritePicker
                    value={entry.spriteType ?? ''}
                    onChange={v => {
                      setRoster(prev => prev.map((r, i) => i === ri ? { ...r, spriteType: v } : r));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setRoster(prev => prev.map((r, i) => i === ri ? { ...r, visible: r.visible === false ? undefined : false } : r));
                    }}
                    className={`h-8 px-2 rounded-md text-xs cursor-pointer border ${
                      entry.visible !== false
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                        : 'bg-red-500/10 border-red-500/30 text-red-500'
                    }`}
                    title={entry.visible !== false ? '点击隐藏此角色' : '点击显示此角色'}
                  >
                    {entry.visible !== false ? '👁️' : '🚫'}
                  </button>
                </div>
              </div>
              );
            })}

            {/* Template-derived roles */}
            {allRoleIds.length > 0 && (
              <>
                {allRoleIds.map(roleId => {
                  const entry = getRosterEntry(roleId);
                  return (
                    <div key={roleId} className="rounded-lg border border-border/60 p-3 bg-muted/20 space-y-2">
                      <div className="flex gap-2 items-center">
                        <span className="text-xs font-mono text-muted-foreground w-40 truncate shrink-0" title={roleId}>
                          {roleId}
                        </span>
                        <Input
                          className="flex-1 h-9 text-xs"
                          value={entry?.displayName ?? ''}
                          onChange={e => updateRosterEntry(roleId, { displayName: e.target.value })}
                          placeholder="名字"
                          aria-label={`${roleId} 的名字`}
                        />
                        <Input
                          className="w-28 h-9 text-xs"
                          value={entry?.title ?? ''}
                          onChange={e => updateRosterEntry(roleId, { title: e.target.value })}
                          placeholder="职称（可选）"
                          aria-label={`${roleId} 的职称`}
                        />
                      </div>
                      <div className="flex gap-2 items-center pl-40">
                        <span className="text-xs text-muted-foreground shrink-0">形象:</span>
                        <SpritePicker
                          value={entry?.spriteType ?? ''}
                          onChange={v => updateRosterEntry(roleId, { spriteType: v })}
                        />
                        <button
                          type="button"
                          onClick={() => updateRosterEntry(roleId, { visible: entry?.visible === false ? undefined : false })}
                          className={`h-8 px-2 rounded-md text-xs cursor-pointer border ${
                            entry?.visible !== false
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                              : 'bg-red-500/10 border-red-500/30 text-red-500'
                          }`}
                          title={entry?.visible !== false ? '点击隐藏此角色' : '点击显示此角色'}
                        >
                          {entry?.visible !== false ? '👁️' : '🚫'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Add manual entry button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRoster(prev => [...prev, { rolePattern: '', displayName: '', spriteType: undefined }])}
              className="h-9 text-xs cursor-pointer w-full"
            >
              + 手动添加角色
            </Button>
          </TabsContent>

          {/* ── OKR Tab ───────────────────────────────────────────────── */}
          <TabsContent value="okr" className="space-y-4 pt-4 pb-2 overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              设定部门目标和关键结果（可选）。不设置也不影响正常使用。
            </p>
            <div className="flex items-center gap-3">
              <label htmlFor="okr-period" className="text-xs font-medium whitespace-nowrap text-muted-foreground">周期</label>
              <Input
                id="okr-period"
                className="w-32 h-9 text-xs"
                value={okr?.period ?? ''}
                onChange={e => { ensureOkr(); updateOkrPeriod(e.target.value); }}
                placeholder="2026-Q1"
              />
            </div>
            {(okr?.objectives ?? []).map((obj, oi) => (
              <div key={oi} className="rounded-lg border border-border/60 p-3 space-y-2.5 bg-muted/20">
                <div className="flex gap-2">
                  <Input
                    className="flex-1 h-9 text-xs"
                    value={obj.title}
                    onChange={e => updateObjectiveTitle(oi, e.target.value)}
                    placeholder={`目标 ${oi + 1}`}
                    aria-label={`目标 ${oi + 1} 标题`}
                  />
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeObjective(oi)} aria-label={`删除目标 ${oi + 1}`}>×</Button>
                </div>
                {obj.keyResults.map((kr, ki) => (
                  <div key={ki} className="flex gap-2 items-center pl-3">
                    <span className="text-xs text-muted-foreground font-medium">KR</span>
                    <Input
                      className="flex-1 h-8 text-xs"
                      value={kr.description}
                      onChange={e => updateKR(oi, ki, { description: e.target.value })}
                      placeholder="关键结果"
                      aria-label={`目标 ${oi + 1} 关键结果 ${ki + 1}`}
                    />
                    <Input
                      className="w-16 h-8 text-xs text-center"
                      type="number"
                      value={kr.current}
                      onChange={e => updateKR(oi, ki, { current: Number(e.target.value) })}
                      aria-label="当前值"
                    />
                    <span className="text-xs text-muted-foreground">/</span>
                    <Input
                      className="w-16 h-8 text-xs text-center"
                      type="number"
                      value={kr.target}
                      onChange={e => updateKR(oi, ki, { target: Number(e.target.value) })}
                      aria-label="目标值"
                    />
                    {kr.current > kr.target && <span className="text-xs text-yellow-500" role="alert">⚠</span>}
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => removeKR(oi, ki)} aria-label={`删除关键结果 ${ki + 1}`}>×</Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => addKR(oi)} className="ml-3 text-xs text-muted-foreground h-8 px-3 cursor-pointer">
                  + KR
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addObjective} className="h-9 text-xs cursor-pointer">
              + 添加目标
            </Button>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-border/40 shrink-0">
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? '保存中…' : '保存配置'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

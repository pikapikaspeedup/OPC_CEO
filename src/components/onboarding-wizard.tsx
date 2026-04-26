'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import SkillBrowser from '@/components/skill-browser';
import type { DepartmentConfig } from '@/lib/types';

// ─── Preset Types ────────────────────────────────────────────────────────────

const PRESET_TYPES: Array<{ value: string; icon: string; label: string; desc: string }> = [
  { value: 'build', icon: '🔧', label: 'Build', desc: '产研/开发' },
  { value: 'research', icon: '🔬', label: 'Research', desc: '调研/分析' },
  { value: 'operations', icon: '⚙️', label: 'Operations', desc: '运营/运维' },
  { value: 'ceo', icon: '👔', label: 'CEO Office', desc: 'CEO 专属房间' },
];

function getTypeDisplay(type: string, icon?: string): string {
  const preset = PRESET_TYPES.find(p => p.value === type);
  const resolvedIcon = icon || preset?.icon || '🏢';
  return `${resolvedIcon} ${type}`;
}

// ─── Step Config ─────────────────────────────────────────────────────────────

interface StepConfig {
  name: string;
  type: string;
  typeIcon: string;
  customType: string;
  description: string;
}

function defaultStep(initialConfig: DepartmentConfig): StepConfig {
  const isPreset = PRESET_TYPES.some(p => p.value === initialConfig.type);
  return {
    name: initialConfig.name,
    type: initialConfig.type,
    typeIcon: initialConfig.typeIcon ?? PRESET_TYPES.find(p => p.value === initialConfig.type)?.icon ?? '',
    customType: isPreset ? '' : initialConfig.type,
    description: initialConfig.description ?? '',
  };
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface OnboardingWizardProps {
  workspaces: Array<{ name: string; uri: string }>;
  departments: Map<string, DepartmentConfig>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (departments: Map<string, DepartmentConfig>) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnboardingWizard({
  workspaces,
  departments,
  open,
  onOpenChange,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [stepConfigs, setStepConfigs] = useState<StepConfig[]>(() =>
    workspaces.map(ws => defaultStep(departments.get(ws.uri) ?? { name: ws.name, type: 'build', skills: [], okr: null })),
  );
  const [saving, setSaving] = useState(false);

  const totalSteps = workspaces.length;
  const wsIndex = step - 1;
  const currentWs = workspaces[wsIndex];
  const currentCfg = stepConfigs[wsIndex];
  const currentDept = currentWs ? departments.get(currentWs.uri) : undefined;
  const currentSkills = currentDept?.skills ?? [];
  const previewSkillMap = new Map<string, typeof currentSkills[number]>();
  for (const ws of workspaces) {
    for (const skill of departments.get(ws.uri)?.skills ?? []) {
      if (!previewSkillMap.has(skill.skillId)) {
        previewSkillMap.set(skill.skillId, skill);
      }
    }
  }
  const previewSkills = Array.from(previewSkillMap.values());
  const currentSkillSummary = {
    total: currentSkills.length,
    withWorkflow: currentSkills.filter(skill => skill.workflowRef?.trim()).length,
    withFallback: currentSkills.filter(skill => (skill.skillRefs ?? []).some(ref => ref.trim())).length,
  };

  // ── Mutators ────────────────────────────────────────────────────────────

  const updateCurrentCfg = useCallback((patch: Partial<StepConfig>) => {
    setStepConfigs(prev =>
      prev.map((cfg, i) => (i === wsIndex ? { ...cfg, ...patch } : cfg)),
    );
  }, [wsIndex]);

  const selectPresetType = useCallback((value: string, icon: string) => {
    setStepConfigs(prev =>
      prev.map((cfg, i) =>
        i === wsIndex ? { ...cfg, type: value, typeIcon: icon, customType: '' } : cfg,
      ),
    );
  }, [wsIndex]);

  // ── Save step and advance ────────────────────────────────────────────────

  async function saveAndNext() {
    if (currentCfg && currentWs) {
      setSaving(true);
      try {
        const resolvedType = currentCfg.customType.trim() || currentCfg.type;
        const resolvedIcon = currentCfg.typeIcon.trim() || PRESET_TYPES.find(p => p.value === resolvedType)?.icon || '';
        const existing = departments.get(currentWs.uri);
        const config: DepartmentConfig = {
          name: currentCfg.name.trim() || currentWs.name,
          type: resolvedType,
          ...(resolvedIcon ? { typeIcon: resolvedIcon } : {}),
          ...(currentCfg.description.trim() ? { description: currentCfg.description.trim() } : {}),
          skills: existing?.skills ?? [],
          okr: existing?.okr ?? null,
        };
        await api.updateDepartment(currentWs.uri, config);
      } finally {
        setSaving(false);
      }
    }
    setStep(s => s + 1);
  }

  // ── Complete ─────────────────────────────────────────────────────────────

  async function handleComplete() {
    const newMap = new Map(departments);
    for (const [i, ws] of workspaces.entries()) {
      const cfg = stepConfigs[i];
      const resolvedType = cfg.customType.trim() || cfg.type;
      const resolvedIcon = cfg.typeIcon.trim() || PRESET_TYPES.find(p => p.value === resolvedType)?.icon || '';
      const existing = departments.get(ws.uri);
      newMap.set(ws.uri, {
        name: cfg.name || ws.name,
        type: resolvedType,
        ...(resolvedIcon ? { typeIcon: resolvedIcon } : {}),
        ...(cfg.description.trim() ? { description: cfg.description.trim() } : {}),
        skills: existing?.skills ?? [],
        okr: existing?.okr ?? null,
      });
    }
    onComplete(newMap);
    onOpenChange(false);
  }

  // ── Reset on open ─────────────────────────────────────────────────────────

  const handleOpenChange = (v: boolean) => {
    if (v) {
      setStep(0);
      setStepConfigs(
        workspaces.map(ws => defaultStep(departments.get(ws.uri) ?? { name: ws.name, type: 'build', skills: [], okr: null })),
      );
    }
    onOpenChange(v);
  };

  // ─── Progress bar helper ──────────────────────────────────────────────────

  const progress = step === 0 ? 0 : step > totalSteps ? 100 : Math.round((step / totalSteps) * 100);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
        {/* Progress bar */}
        {step > 0 && (
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <div className="px-6 pt-5 pb-5 space-y-4">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">配置你的虚拟公司</DialogTitle>
                <DialogDescription className="text-sm leading-relaxed pt-1">
                  你有 <strong className="text-foreground">{workspaces.length}</strong> 个工作区，每个工作区对应一个部门。
                  配置部门名称、类型和定位后，CEO 就能精准派活了。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                部门能力按
                <span className="text-foreground font-medium"> skill → workflowRef → skillRefs </span>
                顺序执行。
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => onOpenChange(false)}>
                  跳过
                </Button>
                <Button onClick={() => setStep(1)} size="sm">
                  开始配置
                </Button>
              </div>
            </>
          )}

          {/* Steps 1..N: per workspace */}
          {step >= 1 && step <= totalSteps && currentWs && currentCfg && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-normal">{step}/{totalSteps}</span>
                  {currentWs.name}
                </DialogTitle>
                <DialogDescription className="text-xs truncate">
                  {currentWs.uri}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Name */}
                <div className="space-y-1.5">
                  <label htmlFor={`ws-name-${wsIndex}`} className="text-sm font-medium text-foreground">部门名称</label>
                  <Input
                    id={`ws-name-${wsIndex}`}
                    value={currentCfg.name}
                    onChange={e => updateCurrentCfg({ name: e.target.value })}
                    placeholder={currentWs.name}
                    className="h-9"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label htmlFor={`ws-desc-${wsIndex}`} className="text-sm font-medium text-foreground">部门定位</label>
                  <textarea
                    id={`ws-desc-${wsIndex}`}
                    value={currentCfg.description}
                    onChange={e => updateCurrentCfg({ description: e.target.value })}
                    placeholder="简要介绍部门职责…"
                    rows={2}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                  <p className="text-xs text-muted-foreground">CEO 根据定位来匹配部门</p>
                </div>

                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">能力声明预览</div>
                    <div className="text-[11px] text-muted-foreground">skill → workflowRef → skillRefs</div>
                  </div>
                  <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                    <div>技能数：<span className="text-foreground font-medium">{currentSkillSummary.total}</span></div>
                    <div>绑定 Workflow：<span className="text-foreground font-medium">{currentSkillSummary.withWorkflow}</span></div>
                    <div>Fallback 列表：<span className="text-foreground font-medium">{currentSkillSummary.withFallback}</span></div>
                  </div>
                  {currentSkills.length > 0 ? (
                    <div className="max-h-56 overflow-y-auto pr-1">
                      <SkillBrowser skills={currentSkills} />
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground leading-relaxed">
                      这个部门还没有配置技能。完成初始化后，可以到部门配置页补全能力声明。
                    </div>
                  )}
                </div>

                {/* Type */}
                <div className="space-y-2">
                  <span className="text-sm font-medium text-foreground">部门类型</span>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="部门类型">
                    {PRESET_TYPES.map(p => {
                      const selected = currentCfg.type === p.value && !currentCfg.customType;
                      return (
                        <button
                          type="button"
                          key={p.value}
                          role="radio"
                          aria-checked={selected}
                          onClick={() => selectPresetType(p.value, p.icon)}
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
                      value={currentCfg.customType}
                      onChange={e => updateCurrentCfg({
                        customType: e.target.value,
                        type: e.target.value || 'build',
                      })}
                      placeholder="或输入自定义类型…"
                      aria-label="自定义部门类型"
                    />
                    <Input
                      className="w-14 h-9 text-center text-base"
                      value={currentCfg.typeIcon}
                      onChange={e => updateCurrentCfg({ typeIcon: e.target.value })}
                      placeholder="📌"
                      maxLength={2}
                      aria-label="部门图标"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setStep(s => s - 1)} disabled={saving}>
                  ← 上一步
                </Button>
                <Button onClick={saveAndNext} disabled={saving} size="sm">
                  {saving ? '保存中…' : step < totalSteps ? '下一步 →' : '完成 →'}
                </Button>
              </div>
            </>
          )}

          {/* Step N+1: Done */}
          {step > totalSteps && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">配置完成</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {workspaces.map((ws, i) => {
                    const cfg = stepConfigs[i];
                    const resolvedType = cfg.customType.trim() || cfg.type;
                    return (
                      <div key={ws.uri} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 bg-muted/20">
                        <span className="text-sm">{getTypeDisplay(resolvedType, cfg.typeIcon)}</span>
                        <span className="text-sm font-medium flex-1">{cfg.name || ws.name}</span>
                        {cfg.description.trim() && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">{cfg.description}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {previewSkills.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">部门能力预览</div>
                      <div className="text-[11px] text-muted-foreground">skill → workflowRef → skillRefs</div>
                    </div>
                    <SkillBrowser skills={previewSkills} />
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                  在 CEO 指令框输入任务 → 自动匹配最合适的部门
                </p>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleComplete} size="sm">进入 Dashboard</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

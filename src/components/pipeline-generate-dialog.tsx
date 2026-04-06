'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/components/locale-provider';
import {
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  RotateCw,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { TemplateSummaryFE, GenerationResultFE, RiskAssessmentFE } from '@/lib/types';

type Phase = 'input' | 'generating' | 'preview' | 'confirming' | 'confirmed' | 'error';

interface PipelineGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates?: TemplateSummaryFE[];
  onConfirmed?: (templateId: string) => void;
}

export default function PipelineGenerateDialog({
  open,
  onOpenChange,
  templates,
  onConfirmed,
}: PipelineGenerateDialogProps) {
  const { t } = useI18n();

  const [phase, setPhase] = useState<Phase>('input');
  const [goal, setGoal] = useState('');
  const [constraints, setConstraints] = useState('');
  const [referenceTemplateId, setReferenceTemplateId] = useState('');

  // Structured constraints
  const [maxStages, setMaxStages] = useState<number>(0);
  const [allowFanOut, setAllowFanOut] = useState(true);
  const [allowLoop, setAllowLoop] = useState(true);
  const [allowGate, setAllowGate] = useState(true);
  const [techStack, setTechStack] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [result, setResult] = useState<GenerationResultFE | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [risksExpanded, setRisksExpanded] = useState(true);
  const [nodesExpanded, setNodesExpanded] = useState(false);

  const hasCriticalRisk = result?.risks.some(r => r.severity === 'critical') ?? false;
  const hasWarnings = result?.risks.some(r => r.severity === 'warning') ?? false;

  // Check for a saved draft on mount
  const hasSavedDraft = typeof window !== 'undefined' && !!localStorage.getItem('ag_draft_id');

  const reset = () => {
    setPhase('input');
    setGoal('');
    setConstraints('');
    setReferenceTemplateId('');
    setMaxStages(0);
    setAllowFanOut(true);
    setAllowLoop(true);
    setAllowGate(true);
    setTechStack('');
    setTeamSize('');
    setResult(null);
    setErrorMessage('');
    setRisksExpanded(true);
    setNodesExpanded(false);
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) reset();
    onOpenChange(newOpen);
  };

  const handleRecoverDraft = async () => {
    const draftId = localStorage.getItem('ag_draft_id');
    if (!draftId) return;
    setPhase('generating');
    setErrorMessage('');
    try {
      const res = await api.getDraft(draftId);
      setResult(res);
      setPhase('preview');
    } catch {
      localStorage.removeItem('ag_draft_id');
      setErrorMessage('Draft not found or expired');
      setPhase('error');
    }
  };

  // Build structured constraints object
  const buildConstraints = () => {
    const c: Record<string, unknown> = {};
    if (maxStages > 0) c.maxStages = maxStages;
    if (!allowFanOut) c.allowFanOut = false;
    if (!allowLoop) c.allowLoop = false;
    if (!allowGate) c.allowGate = false;
    if (techStack.trim()) c.techStack = techStack.trim();
    if (teamSize.trim()) c.teamSize = teamSize.trim();
    const freeText = constraints.trim();
    if (freeText) c.freeText = freeText;
    return Object.keys(c).length > 0 ? JSON.stringify(c) : undefined;
  };

  const handleGenerate = async () => {
    setPhase('generating');
    setErrorMessage('');
    try {
      const res = await api.generatePipeline({
        goal,
        constraints: buildConstraints(),
        referenceTemplateId: referenceTemplateId || undefined,
      });
      setResult(res);
      // Cache draftId for recovery
      if (typeof window !== 'undefined') localStorage.setItem('ag_draft_id', res.draftId);
      setPhase('preview');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const handleConfirm = async () => {
    if (!result) return;
    setPhase('confirming');
    try {
      const res = await api.confirmDraft(result.draftId);
      if (res.saved) {
        if (typeof window !== 'undefined') localStorage.removeItem('ag_draft_id');
        setPhase('confirmed');
        onConfirmed?.(res.templateId);
      } else {
        setErrorMessage(res.validationErrors?.join('; ') || t('generate.confirmFailed'));
        setPhase('error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const riskIcon = (severity: RiskAssessmentFE['severity']) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
      case 'warning': return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
      case 'info': return <Info className="h-3.5 w-3.5 text-sky-400" />;
    }
  };

  const riskBadgeVariant = (severity: RiskAssessmentFE['severity']) => {
    switch (severity) {
      case 'critical': return 'destructive' as const;
      case 'warning': return 'outline' as const;
      case 'info': return 'secondary' as const;
    }
  };

  // Extract nodes from result for preview
  const nodes = result?.graphPipeline
    ? (result.graphPipeline as { nodes?: Array<{ id: string; kind?: string; title?: string; executionMode?: string }> }).nodes ?? []
    : [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            {t('generate.title')}
          </DialogTitle>
        </DialogHeader>

        {/* Phase: Input */}
        {phase === 'input' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">
                {t('generate.goal')} *
              </label>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={t('generate.goalPlaceholder')}
                className="bg-white/5 min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">
                {t('generate.constraints')}
              </label>

              {/* Structured constraints */}
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
                {/* Pipeline patterns */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-muted)]">
                    允许的管线模式
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'fanOut', label: 'Fan-Out 并行分支', value: allowFanOut, set: setAllowFanOut },
                      { key: 'loop', label: 'Loop 循环', value: allowLoop, set: setAllowLoop },
                      { key: 'gate', label: 'Gate 审批门', value: allowGate, set: setAllowGate },
                    ].map(({ key, label, value, set }) => (
                      <button
                        key={key}
                        className={cn(
                          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          value
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            : 'bg-white/[0.03] text-white/30 border-white/8',
                        )}
                        onClick={() => set(!value)}
                        type="button"
                      >
                        {value ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Max stages */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--app-text-soft)]">最大阶段数 (0=不限)</span>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={maxStages}
                    onChange={(e) => setMaxStages(parseInt(e.target.value) || 0)}
                    className="w-20 h-7 text-xs bg-white/5"
                  />
                </div>

                {/* Tech stack & team */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[10px] text-[var(--app-text-muted)]">技术栈</span>
                    <Input
                      value={techStack}
                      onChange={(e) => setTechStack(e.target.value)}
                      placeholder="如: Next.js, Python"
                      className="h-7 text-xs bg-white/5"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-[var(--app-text-muted)]">团队规模</span>
                    <Input
                      value={teamSize}
                      onChange={(e) => setTeamSize(e.target.value)}
                      placeholder="如: 3人, 小型"
                      className="h-7 text-xs bg-white/5"
                    />
                  </div>
                </div>
              </div>

              {/* Free-text constraints */}
              <Textarea
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder={t('generate.constraintsPlaceholder')}
                className="bg-white/5 min-h-[50px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">
                {t('generate.referenceTemplate')}
              </label>
              <NativeSelect
                value={referenceTemplateId || 'none'}
                onChange={(e) => setReferenceTemplateId(!e.target.value || e.target.value === 'none' ? '' : e.target.value)}
                className="bg-white/5"
              >
                <option value="none">{t('generate.noReference')}</option>
                {templates?.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}

        {/* Phase: Generating */}
        {phase === 'generating' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
            <p className="text-sm text-[var(--app-text-soft)]">{t('generate.generating')}</p>
          </div>
        )}

        {/* Phase: Preview */}
        {phase === 'preview' && result && (
          <div className="space-y-4 py-2">
            {/* Template meta */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-1">
              <p className="text-sm font-semibold">{result.templateMeta.name}</p>
              {result.templateMeta.description && (
                <p className="text-xs text-[var(--app-text-soft)]">{result.templateMeta.description}</p>
              )}
            </div>

            {/* AI explanation */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                {t('generate.explanation')}
              </h4>
              <p className="text-sm text-[var(--app-text-soft)] whitespace-pre-wrap">{result.explanation}</p>
            </div>

            {/* Validation */}
            <div className="flex items-center gap-2">
              {result.validation.valid ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  {t('generate.dagValid')}
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {t('generate.dagInvalid')}
                </Badge>
              )}
              <span className="text-xs text-[var(--app-text-muted)]">
                {nodes.length} {t('generate.nodes')}
              </span>
            </div>

            {/* Risks panel */}
            {result.risks.length > 0 && (
              <div className="space-y-2">
                <button
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)] hover:text-[var(--app-text-soft)]"
                  onClick={() => setRisksExpanded(!risksExpanded)}
                >
                  {risksExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {t('generate.risks')} ({result.risks.length})
                </button>
                {risksExpanded && (
                  <div className="space-y-1.5">
                    {result.risks.map((risk, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                          risk.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' :
                          risk.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/5' :
                          'border-sky-500/20 bg-sky-500/5',
                        )}
                      >
                        <span className="mt-0.5 shrink-0">{riskIcon(risk.severity)}</span>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={riskBadgeVariant(risk.severity)} className="text-[10px] px-1.5 py-0 h-4">
                              {risk.severity}
                            </Badge>
                            <span className="text-[var(--app-text-muted)]">{risk.category}</span>
                          </div>
                          <p className="text-[var(--app-text-soft)]">{risk.message}</p>
                          {risk.suggestion && (
                            <p className="text-[var(--app-text-muted)] italic">{risk.suggestion}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Nodes list */}
            {nodes.length > 0 && (
              <div className="space-y-2">
                <button
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)] hover:text-[var(--app-text-soft)]"
                  onClick={() => setNodesExpanded(!nodesExpanded)}
                >
                  {nodesExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {t('generate.nodeList')}
                </button>
                {nodesExpanded && (
                  <div className="grid grid-cols-1 gap-1">
                    {nodes.map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-mono text-[var(--app-text-soft)]">{node.id}</span>
                        {node.kind && node.kind !== 'stage' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {node.kind}
                          </Badge>
                        )}
                        {(node.title || node.executionMode) && (
                          <span className="text-[var(--app-text-muted)]">
                            {node.title || node.executionMode}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Critical risk warning */}
            {hasCriticalRisk && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {t('generate.criticalBlocksSave')}
              </div>
            )}
          </div>
        )}

        {/* Phase: Confirming */}
        {phase === 'confirming' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-sm text-[var(--app-text-soft)]">{t('generate.saving')}</p>
          </div>
        )}

        {/* Phase: Confirmed */}
        {phase === 'confirmed' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="text-sm font-medium">{t('generate.savedSuccess')}</p>
          </div>
        )}

        {/* Phase: Error */}
        {phase === 'error' && (
          <div className="space-y-4 py-6">
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <DialogFooter>
          {phase === 'input' && (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>{t('common.cancel')}</Button>
              {hasSavedDraft && (
                <Button variant="outline" onClick={handleRecoverDraft}>
                  <RotateCw className="h-4 w-4 mr-1" />
                  {t('generate.recoverDraft') ?? 'Recover Draft'}
                </Button>
              )}
              <Button onClick={handleGenerate} disabled={!goal.trim()}>
                <Sparkles className="h-4 w-4 mr-1" />
                {t('generate.generateBtn')}
              </Button>
            </>
          )}
          {phase === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setPhase('input')}>
                {t('generate.back')}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={hasCriticalRisk}
                title={hasCriticalRisk ? t('generate.criticalBlocksSave') : undefined}
              >
                {hasWarnings && !hasCriticalRisk ? t('generate.confirmWithWarnings') : t('generate.saveAsTemplate')}
              </Button>
            </>
          )}
          {phase === 'confirmed' && (
            <Button onClick={() => handleClose(false)}>
              {t('common.close')}
            </Button>
          )}
          {phase === 'error' && (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => setPhase('input')}>{t('generate.tryAgain')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

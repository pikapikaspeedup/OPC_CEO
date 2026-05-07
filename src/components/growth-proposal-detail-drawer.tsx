'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { GrowthProposalFE } from '@/lib/types';
import { cn } from '@/lib/utils';

type GrowthProposalDetailDrawerProps = {
  proposalId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
};

function statusTone(status: GrowthProposalFE['status']): string {
  if (status === 'published' || status === 'observing') return 'bg-emerald-50 text-emerald-700';
  if (status === 'approval-required') return 'bg-amber-50 text-amber-700';
  if (status === 'rejected') return 'bg-red-50 text-red-700';
  return 'bg-blue-50 text-blue-700';
}

function riskTone(risk: GrowthProposalFE['risk']): string {
  if (risk === 'high') return 'bg-red-50 text-red-700';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

export default function GrowthProposalDetailDrawer({
  proposalId,
  open,
  onOpenChange,
  onChanged,
}: GrowthProposalDetailDrawerProps) {
  const [proposal, setProposal] = useState<GrowthProposalFE | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProposal = useCallback(async () => {
    if (!proposalId || !open) return;
    setLoading(true);
    setError(null);
    try {
      setProposal(await api.companyGrowthProposal(proposalId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [open, proposalId]);

  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  const evidenceCount = proposal?.evidenceRefs.length || 0;
  const sourceCount = useMemo(
    () => (proposal?.sourceRunIds.length || 0)
      + (proposal?.sourceCapsuleIds.length || 0)
      + (proposal?.sourceKnowledgeIds.length || 0)
      + (proposal?.sourceCandidateIds.length || 0),
    [proposal],
  );

  const runAction = async (action: 'approve' | 'reject' | 'publish') => {
    if (!proposal) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'approve' && proposal.approvalRequestId) {
        await api.respondApproval(proposal.approvalRequestId, 'approved', '批准增长提案发布。');
        setProposal(await api.companyGrowthProposal(proposal.id));
      } else if (action === 'reject' && proposal.approvalRequestId) {
        await api.respondApproval(proposal.approvalRequestId, 'rejected', '拒绝增长提案发布。');
        setProposal(await api.companyGrowthProposal(proposal.id));
      } else {
        const response = action === 'approve'
          ? await api.approveCompanyGrowthProposal(proposal.id)
          : action === 'reject'
            ? await api.rejectCompanyGrowthProposal(proposal.id)
            : await api.publishCompanyGrowthProposal(proposal.id);
        setProposal(response.proposal);
      }
      onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[860px] flex-col overflow-hidden bg-[#f7f9fc] shadow-[-18px_0_40px_rgba(15,23,42,0.18)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#dfe5ee] bg-white px-8 py-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
                <Sparkles className="h-5 w-5" />
              </span>
              <h2 className="line-clamp-2 text-2xl font-semibold leading-tight text-[#111827]">
                {proposal?.title || 'Growth proposal'}
              </h2>
            </div>
            {proposal ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusTone(proposal.status))}>{proposal.status}</span>
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', riskTone(proposal.risk))}>{proposal.risk}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{proposal.kind}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{proposal.score} 分</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading
            </div>
          ) : error ? (
            <div className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : proposal ? (
            <div className="space-y-4">
              <section className="rounded-[14px] border border-[#dfe5ee] bg-white p-5">
                <h3 className="text-sm font-semibold text-[#111827]">审批信息</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[12px] border border-[#e5ebf3] bg-[#fbfcff] p-4">
                    <div className="text-xs font-semibold text-[#8a96aa]">解决的问题</div>
                    <div className="mt-2 text-sm leading-6 text-[#334155]">{proposal.summary}</div>
                  </div>
                  <div className="rounded-[12px] border border-[#e5ebf3] bg-[#fbfcff] p-4">
                    <div className="text-xs font-semibold text-[#8a96aa]">影响范围</div>
                    <div className="mt-2 text-sm leading-6 text-[#334155]">
                      {proposal.targetName}
                      <div className="mt-2 text-xs text-[#7c8799]">{sourceCount} 个来源 · {evidenceCount} 份证据</div>
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[#e5ebf3] bg-[#fbfcff] p-4">
                    <div className="text-xs font-semibold text-[#8a96aa]">批准后 AI 会做什么</div>
                    <div className="mt-2 text-sm leading-6 text-[#334155]">
                      {proposal.status === 'approval-required' ? '发布增长资产' : proposal.status}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[14px] border border-[#dfe5ee] bg-white p-5">
                <h3 className="text-sm font-semibold text-[#111827]">提案内容</h3>
                <pre className="mt-4 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-[12px] border border-[#e5ebf3] bg-[#fbfcff] p-4 text-sm leading-6 text-[#334155]">
                  {proposal.content}
                </pre>
              </section>
            </div>
          ) : null}
        </div>

        {proposal ? (
          <footer className="shrink-0 border-t border-[#dfe5ee] bg-white px-8 py-4">
            <div className="flex flex-wrap items-center justify-end gap-3">
              {proposal.status === 'approval-required' ? (
                <>
                  <Button variant="outline" onClick={() => void runAction('reject')} disabled={Boolean(busy)}>
                    {busy === 'reject' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    拒绝
                  </Button>
                  <Button onClick={() => void runAction('approve')} disabled={Boolean(busy)}>
                    {busy === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    批准
                  </Button>
                </>
              ) : null}
              {proposal.status === 'approved' ? (
                <Button onClick={() => void runAction('publish')} disabled={Boolean(busy)}>
                  {busy === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  发布
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

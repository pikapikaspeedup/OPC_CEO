'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { SubgraphSummaryFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Loader2, Network, ArrowRightFromLine, ArrowLeftToLine } from 'lucide-react';

export default function SubgraphPanel() {
  const [subgraphs, setSubgraphs] = useState<SubgraphSummaryFE[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.listSubgraphs();
        setSubgraphs(data);
      } catch {
        // optional feature
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (subgraphs.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-white/40">
        No subgraphs defined yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {subgraphs.map((sg) => {
        const isExpanded = expanded === sg.id;
        return (
          <div
            key={sg.id}
            className={cn(
              'rounded-xl border border-white/8 bg-white/[0.02] transition-colors',
              isExpanded && 'border-sky-400/20 bg-sky-400/[0.03]',
            )}
          >
            <button
              className="flex items-center gap-3 w-full p-3 text-left"
              onClick={() => setExpanded(isExpanded ? null : sg.id)}
            >
              <Network className="h-4 w-4 text-sky-400/60 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white/80 truncate">{sg.title}</div>
                {sg.description && (
                  <div className="text-[10px] text-white/40 truncate mt-0.5">{sg.description}</div>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-mono text-white/40">
                {sg.nodeCount} nodes
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-white/6 pt-2">
                {sg.inputs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-400/50 mb-1">
                      <ArrowRightFromLine className="h-2.5 w-2.5" /> Inputs
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {sg.inputs.map((inp) => (
                        <span key={inp.id} className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400/70">
                          {inp.id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {sg.outputs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-violet-400/50 mb-1">
                      <ArrowLeftToLine className="h-2.5 w-2.5" /> Outputs
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {sg.outputs.map((out) => (
                        <span key={out.id} className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-400/70">
                          {out.id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

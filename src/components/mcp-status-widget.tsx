'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { McpConfig, McpServer } from '@/lib/types';
import { cn } from '@/lib/utils';

interface McpStatusWidgetProps {
  className?: string;
}

export default function McpStatusWidget({ className }: McpStatusWidgetProps) {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.mcp();
      setConfig(result);
    } catch {
      setConfig({ servers: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return null;

  const servers = config?.servers ?? [];

  return (
    <div className={cn('rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3', className)}>
      <div className="text-xs font-semibold uppercase tracking-widest text-white/40">
        🔌 MCP 服务器
      </div>

      {servers.length === 0 ? (
        <p className="text-xs text-white/30">未配置 MCP 服务器</p>
      ) : (
        <div className="space-y-2">
          {servers.map((s, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400/80" title="已配置" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white/70 truncate">
                  {s.name || s.command || `Server ${i + 1}`}
                </div>
                {s.description && (
                  <div className="text-[10px] text-white/30 truncate">{s.description}</div>
                )}
              </div>
              {s.command && (
                <code className="text-[10px] text-white/20 font-mono truncate max-w-[140px]">
                  {s.command}
                </code>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-white/20">
        配置文件: ~/.gemini/antigravity/mcp_config.json
      </p>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { McpConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceIconFrame,
  WorkspaceListItem,
  WorkspaceSectionHeader,
  WorkspaceStatusDot,
  WorkspaceSurface,
} from '@/components/ui/workspace-primitives';
import { Plug } from 'lucide-react';

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
    <WorkspaceSurface className={cn('space-y-3', className)}>
      <WorkspaceSectionHeader
        eyebrow="MCP"
        title="MCP 服务器"
        icon={<Plug className="h-4 w-4" />}
        actions={<WorkspaceBadge tone={servers.length ? 'success' : 'neutral'}>{servers.length} configured</WorkspaceBadge>}
      />

      {servers.length === 0 ? (
        <WorkspaceEmptyBlock
          title="未配置 MCP 服务器"
          description="配置后显示可用工具。"
          className="py-5"
        />
      ) : (
        <div className="space-y-2">
          {servers.map((s, i) => (
            <WorkspaceListItem
              key={i}
              icon={<WorkspaceStatusDot tone="success" />}
              title={s.name || s.command || `Server ${i + 1}`}
              description={s.description}
              meta={s.command ? <code className="max-w-[140px] truncate font-mono">{s.command}</code> : undefined}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-[var(--app-text-muted)]">
        <WorkspaceIconFrame tone="neutral" className="h-6 w-6 rounded-lg">
          <Plug className="h-3 w-3" />
        </WorkspaceIconFrame>
        配置文件: ~/.gemini/antigravity/mcp_config.json
      </div>
    </WorkspaceSurface>
  );
}

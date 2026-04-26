'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Send, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceBadge,
  WorkspaceSectionHeader,
  WorkspaceSurface,
  workspaceCodeBlockClassName,
  workspaceFieldClassName,
  workspaceGhostActionClassName,
} from '@/components/ui/workspace-primitives';

type Mode = 'exec' | 'session';

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function CodexWidget() {
  const sessionModeAvailable = false;
  const [mode, setMode] = useState<Mode>('exec');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unknown error';

  const handleExec = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      const result = await api.codexExec({ prompt: prompt.trim() });
      setOutput(result.output);
    } catch (error: unknown) {
      setError(getErrorMessage(error) || 'Codex 执行失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSession = async () => {
    if (!prompt.trim() || loading) return;
    const userPrompt = prompt.trim();
    setPrompt('');
    setLoading(true);
    setError(null);

    const newMessages = [...messages, { role: 'user' as const, content: userPrompt }];
    setMessages(newMessages);

    try {
      if (!threadId) {
        const result = await api.codexCreateSession({ prompt: userPrompt });
        setThreadId(result.threadId);
        setMessages([...newMessages, { role: 'assistant', content: result.content }]);
      } else {
        const result = await api.codexReply(threadId, userPrompt);
        setMessages([...newMessages, { role: 'assistant', content: result.content }]);
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error) || 'Codex 会话失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = mode === 'exec' ? handleExec : handleSession;

  const resetSession = () => {
    setThreadId(null);
    setMessages([]);
    setError(null);
  };

  return (
    <WorkspaceSurface className="space-y-3">
      <WorkspaceSectionHeader
        eyebrow="Local executor"
        title="Codex"
        icon={<Terminal className="h-4 w-4" />}
        actions={(
          <div className="flex gap-1 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-0.5">
          <button
            className={cn(
              'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
              mode === 'exec'
                ? 'bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-soft)]',
            )}
            onClick={() => { setMode('exec'); resetSession(); }}
          >
            单次执行
          </button>
          <button
            className={cn(
              'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
              mode === 'session'
                ? 'bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm'
                : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-soft)]',
              !sessionModeAvailable && 'cursor-not-allowed opacity-40',
            )}
            onClick={() => {
              if (!sessionModeAvailable) return;
              setMode('session');
              setOutput(null);
            }}
            disabled={!sessionModeAvailable}
            title={sessionModeAvailable ? undefined : '旧 codex MCP session 兼容层暂不可用，避免前端命中 500'}
          >
            多轮对话
          </button>
        </div>
        )}
      />

      {!sessionModeAvailable ? (
        <div className="rounded-[18px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-800">
          多轮会话暂不可用。请使用 `CEO Office` / `Conversations`。
        </div>
      ) : null}

      {/* Session messages */}
      {mode === 'session' && messages.length > 0 && (
        <div className={cn('max-h-48 overflow-y-auto space-y-2', workspaceCodeBlockClassName)}>
          {messages.map((msg, i) => (
            <div key={i} className="text-xs text-[var(--app-text-soft)]">
              <WorkspaceBadge tone={msg.role === 'user' ? 'info' : 'accent'} className="mr-2">{msg.role === 'user' ? '你' : 'Codex'}</WorkspaceBadge>
              <span className="whitespace-pre-wrap">{msg.content.slice(0, 500)}{msg.content.length > 500 ? '...' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Exec output */}
      {mode === 'exec' && output && (
        <div className={cn('max-h-32 overflow-y-auto whitespace-pre-wrap', workspaceCodeBlockClassName)}>
          {output.slice(0, 2000)}{output.length > 2000 ? '\n...(truncated)' : ''}
        </div>
      )}

      {error && (
        <div className="rounded-[16px] border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Input */}
      <div className={cn('flex items-center gap-2 rounded-[16px] px-3 py-1.5', workspaceFieldClassName)}>
        <input
          type="text"
          className="flex-1 bg-transparent text-xs text-[var(--app-text)] placeholder:text-[var(--app-text-muted)] outline-none"
          placeholder={mode === 'exec' ? 'Codex 命令...' : threadId ? '继续对话...' : '开始 Codex 会话...'}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
        />
        <button
          className={cn('rounded-full p-1.5 transition-colors disabled:opacity-30', workspaceGhostActionClassName)}
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
          aria-label="提交 Codex 命令"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>

      {mode === 'session' && threadId && (
        <button
          className={cn('text-[10px] transition-colors', workspaceGhostActionClassName)}
          onClick={resetSession}
        >
          重置会话
        </button>
      )}
    </WorkspaceSurface>
  );
}

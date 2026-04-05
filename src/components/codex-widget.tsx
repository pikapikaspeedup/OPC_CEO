'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Loader2, Send, Terminal, MessageSquare } from 'lucide-react';

type Mode = 'exec' | 'session';

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function CodexWidget() {
  const [mode, setMode] = useState<Mode>('exec');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);

  const handleExec = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      const result = await api.codexExec({ prompt: prompt.trim() });
      setOutput(result.output);
    } catch (err: any) {
      setError(err.message || 'Codex 执行失败');
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
    } catch (err: any) {
      setError(err.message || 'Codex 会话失败');
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
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60 flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          Codex
        </h3>
        <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
          <button
            className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${mode === 'exec' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
            onClick={() => { setMode('exec'); resetSession(); }}
          >
            单次执行
          </button>
          <button
            className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${mode === 'session' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
            onClick={() => { setMode('session'); setOutput(null); }}
          >
            多轮对话
          </button>
        </div>
      </div>

      {/* Session messages */}
      {mode === 'session' && messages.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-2 rounded-lg bg-black/20 p-2">
          {messages.map((msg, i) => (
            <div key={i} className={`text-xs ${msg.role === 'user' ? 'text-sky-400/80' : 'text-white/70'}`}>
              <span className="text-[10px] text-white/30">{msg.role === 'user' ? '你' : 'Codex'}:</span>{' '}
              <span className="whitespace-pre-wrap">{msg.content.slice(0, 500)}{msg.content.length > 500 ? '...' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Exec output */}
      {mode === 'exec' && output && (
        <div className="max-h-32 overflow-y-auto rounded-lg bg-black/20 p-2 text-xs text-white/70 whitespace-pre-wrap font-mono">
          {output.slice(0, 2000)}{output.length > 2000 ? '\n...(truncated)' : ''}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400/80 bg-red-500/5 rounded-lg px-2 py-1">{error}</div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-1.5">
        <input
          type="text"
          className="flex-1 bg-transparent text-xs text-white placeholder:text-white/30 outline-none"
          placeholder={mode === 'exec' ? 'Codex 命令...' : threadId ? '继续对话...' : '开始 Codex 会话...'}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
        />
        <button
          className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
          onClick={handleSubmit}
          disabled={loading || !prompt.trim()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>

      {mode === 'session' && threadId && (
        <button
          className="text-[10px] text-white/30 hover:text-white/50 transition-colors"
          onClick={resetSession}
        >
          重置会话
        </button>
      )}
    </div>
  );
}

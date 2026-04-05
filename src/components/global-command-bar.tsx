'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Send, Loader2, Clipboard, Command, ArrowRight, Settings, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { CEOSuggestion } from '@/lib/api';
import type { Workspace, DepartmentConfig } from '@/lib/types';

interface CommandResult {
  success: boolean;
  message: string;
  suggestions?: CEOSuggestion[];
}

interface GlobalCommandBarProps {
  workspaces: Workspace[];
  departments: Map<string, DepartmentConfig>;
  onSubmitCommand: (text: string) => Promise<CommandResult | void>;
  onSuggestionAction?: (suggestion: CEOSuggestion) => void;
}

export default function GlobalCommandBar({ workspaces, departments, onSubmitCommand, onSuggestionAction }: GlobalCommandBarProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ success: boolean; message: string } | null>(null);
  const [suggestions, setSuggestions] = useState<CEOSuggestion[] | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; title: string }>>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load templates once
  useEffect(() => {
    api.pipelines()
      .then(tpls => setTemplates(tpls.map(t => ({ id: t.id, title: t.title }))))
      .catch(() => {});
  }, []);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplates]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSubmit = useCallback(async () => {
    const cmd = text.trim();
    if (!cmd || loading) return;
    setLoading(true);
    setToast(null);
    setSuggestions(null);
    try {
      const result = await onSubmitCommand(cmd);
      if (result) {
        setToast({ success: result.success, message: result.message });
        if (result.suggestions?.length) {
          setSuggestions(result.suggestions);
        }
      } else {
        setToast({ success: true, message: '指令已发送' });
      }
    } catch {
      setToast({ success: false, message: '命令执行失败' });
    } finally {
      setLoading(false);
      setText('');
    }
  }, [text, loading, onSubmitCommand]);

  return (
    <div ref={wrapperRef} className="relative flex-1 max-w-[600px]">
      {/* Input */}
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 
                      focus-within:ring-2 focus-within:ring-sky-500/25 focus-within:border-sky-500/30 transition-all">
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none min-w-0"
          placeholder="说点什么…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
        />
        {/* Template trigger */}
        {templates.length > 0 && (
          <button
            className="rounded-md p-1 text-white/25 hover:text-white/50 transition-colors"
            title="快速模板"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            <Clipboard className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Keyboard hint */}
        {!text && (
          <span className="hidden md:flex items-center gap-0.5 text-[10px] text-white/20 select-none">
            <Command className="h-3 w-3" />K
          </span>
        )}
        {/* Submit */}
        <button
          className="rounded-full p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
          disabled={!text.trim() || loading}
          onClick={handleSubmit}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Template dropdown */}
      {showTemplates && templates.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/10 bg-[rgba(9,17,27,0.96)] backdrop-blur-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">快速创建</div>
          {templates.slice(0, 6).map(tpl => (
            <button
              key={tpl.id}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
              onClick={() => {
                setText(`使用模板 ${tpl.title} 创建新任务`);
                setShowTemplates(false);
                inputRef.current?.focus();
              }}
            >
              <span className="text-xs">📋</span>
              <span className="truncate">{tpl.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toast notification */}
      {toast && !suggestions && (
        <div className={cn(
          'absolute top-full left-1/2 -translate-x-1/2 mt-3 rounded-full border px-4 py-2 text-xs font-medium shadow-lg',
          'animate-in slide-in-from-top-2 fade-in duration-200',
          toast.success
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/20 bg-red-500/10 text-red-300',
        )}>
          {toast.message}
        </div>
      )}

      {/* Decision suggestions panel */}
      {suggestions && suggestions.length > 0 && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setSuggestions(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[rgba(9,17,27,0.97)] backdrop-blur-xl shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-white">需要您的决策</h3>
                {toast && <p className="mt-1 text-xs text-white/50">{toast.message}</p>}
              </div>
              <button
                className="rounded-lg p-1 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                onClick={() => setSuggestions(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Options */}
            <div className="p-3 space-y-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3 text-left hover:border-white/15 hover:bg-white/[0.05] transition-all"
                  onClick={() => {
                    onSuggestionAction?.(s);
                    setSuggestions(null);
                    setToast({ success: true, message: `已选择：${s.label}` });
                  }}
                >
                  <span className="mt-0.5 text-base">
                    {s.type === 'use_template' ? '⚙️' : s.type === 'create_template' ? '✨' : s.type === 'suggest_add_template' ? '📦' : s.type === 'auto_generate_and_dispatch' ? '🤖' : '🔄'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white group-hover:text-sky-300 transition-colors">{s.label}</div>
                    <div className="mt-0.5 text-xs text-white/40 leading-relaxed">{s.description}</div>
                  </div>
                  <ArrowRight className="mt-1 h-3.5 w-3.5 text-white/20 group-hover:text-sky-400/60 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

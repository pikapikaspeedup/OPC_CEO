'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useI18n } from '@/components/locale-provider';
import { cn } from '@/lib/utils';
import { SendHorizontal, Square, ChevronDown, Puzzle, Zap, Rocket, FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ModelConfig, Skill, Workflow } from '@/lib/types';
import { getModelLabel } from '@/lib/model-labels';

interface ChatAttachments {
  media?: Array<{
    mimeType: string;
    inlineData: string;
  }>;
}

interface ChatInputProps {
  activeId?: string;
  onSend: (text: string, attachments?: ChatAttachments) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  connected?: boolean;
  models?: ModelConfig[];
  currentModel?: string;
  onModelChange?: (model: string) => void;
  skills?: Skill[];
  workflows?: Workflow[];
  agenticMode?: boolean;
  onAgenticModeChange?: (mode: boolean) => void;
}

interface AutocompleteItem {
  type: 'skill' | 'workflow' | 'file';
  name: string;
  description: string;
  prefix: string; // what gets inserted
}

interface PastedImage {
  id: string;
  dataUrl: string;
  mimeType: string;
}

export default function ChatInput({ activeId, onSend, onCancel, disabled, isRunning, connected, models, currentModel, onModelChange, skills, workflows, agenticMode = true, onAgenticModeChange }: ChatInputProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [menuItems, setMenuItems] = useState<AutocompleteItem[]>([]);
  const [fileItems, setFileItems] = useState<AutocompleteItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [triggerChar, setTriggerChar] = useState<'/' | '@' | null>(null);
  const [query, setQuery] = useState('');
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (event) => {
          setPastedImages(prev => [...prev, {
            id: Math.random().toString(),
            dataUrl: event.target?.result as string,
            mimeType: file.type,
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px';
    }
  }, [text]);

  // Build autocomplete items
  const allItems = useMemo(() => {
    const items: AutocompleteItem[] = [];
    (workflows || []).forEach(w => {
      items.push({ type: 'workflow', name: w.name, description: w.description || '', prefix: `/${w.name} ` });
    });
    (skills || []).forEach(s => {
      items.push({ type: 'skill', name: s.name, description: s.description || '', prefix: `@${s.name} ` });
    });
    return items;
  }, [skills, workflows]);

  // Compute combined items for @ menu (skills + files)
  const combinedAtItems = useMemo(() => {
    return [...menuItems, ...fileItems];
  }, [menuItems, fileItems]);

  // Handle text changes — detect / and @ triggers
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);

    const slashMatch = textBeforeCursor.match(/(^|\s)\/([\w-]*)$/);
    const atMatch = textBeforeCursor.match(/(^|\s)@([\w\/\.-]*)$/);

    if (slashMatch) {
      const q = slashMatch[2].toLowerCase();
      setTriggerChar('/');
      setQuery(q);
      setFileItems([]);
      setIsLoadingFiles(false);
      const filtered = allItems
        .filter(i => i.type === 'workflow' && i.name.toLowerCase().includes(q))
        .slice(0, 8);
      setMenuItems(filtered);
      setShowMenu(filtered.length > 0);
      setSelectedIdx(0);
    } else if (atMatch) {
      const q = atMatch[2].toLowerCase();
      setTriggerChar('@');
      setQuery(q);
      
      // Immediately show matching skills
      const skillMatches = allItems
        .filter(i => i.type === 'skill' && i.name.toLowerCase().includes(q))
        .slice(0, 5);
      setMenuItems(skillMatches);
      setShowMenu(true);
      setSelectedIdx(0);

      // Debounced file search (300ms)
      if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();

      if (activeId) {
        setIsLoadingFiles(true);
        fileSearchTimerRef.current = setTimeout(async () => {
          const controller = new AbortController();
          abortControllerRef.current = controller;
          try {
            const fileRes = await api.conversationFiles(activeId, q) as { files?: Array<{ name: string; relativePath: string }> };
            if (controller.signal.aborted) return;
            if (fileRes.files && fileRes.files.length > 0) {
              setFileItems(fileRes.files.map((f) => ({
                type: 'file' as const,
                name: f.name,
                description: f.relativePath,
                prefix: `@[${f.relativePath}] `
              })));
            } else {
              setFileItems([]);
            }
          } catch {
            if (!controller.signal.aborted) setFileItems([]);
          } finally {
            if (!controller.signal.aborted) setIsLoadingFiles(false);
          }
        }, 300);
      } else {
        setFileItems([]);
        setIsLoadingFiles(false);
      }

    } else {
      setShowMenu(false);
      setTriggerChar(null);
      setFileItems([]);
      setIsLoadingFiles(false);
      if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    }
  };

  // Insert selected autocomplete item
  const insertItem = useCallback((item: AutocompleteItem) => {
    const textarea = ref.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart || 0;
    const textBeforeCursor = text.slice(0, cursorPos);
    const textAfterCursor = text.slice(cursorPos);

    // Find the trigger position (/ or @)
    const triggerRegex = triggerChar === '/'
      ? /(^|\s)\/([\w-]*)$/
      : /(^|\s)@([\w\/\.-]*)$/;
    const match = textBeforeCursor.match(triggerRegex);

    if (match) {
      const triggerStart = match.index! + match[1].length;
      const newText = text.slice(0, triggerStart) + item.prefix + textAfterCursor;
      setText(newText);
      setShowMenu(false);
      setTriggerChar(null);

      // Set cursor after inserted text
      setTimeout(() => {
        const newPos = triggerStart + item.prefix.length;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
        textarea.focus();
      }, 0);
    }
  }, [text, triggerChar]);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && pastedImages.length === 0) || disabled) return;
    
    const attachments: ChatAttachments = {};
    if (pastedImages.length > 0) {
      attachments.media = pastedImages.map(img => ({
        mimeType: img.mimeType,
        inlineData: img.dataUrl.split(',')[1],
      }));
    }
    
    onSend(trimmed, attachments);
    setText('');
    setShowMenu(false);
    setPastedImages([]);
  }, [text, disabled, onSend, pastedImages]);

  // For @ menus, navigable items = skills + files; for / menus, just menuItems
  const navigableItems = triggerChar === '@' ? combinedAtItems : menuItems;

  const handleKey = (e: React.KeyboardEvent) => {
    if (showMenu && navigableItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => (i + 1) % navigableItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => (i - 1 + navigableItems.length) % navigableItems.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        insertItem(navigableItems[selectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMenu(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Derive display label for the current model
  const currentLabel = getModelLabel(currentModel, models || [], { autoLabel: t('composer.autoSelect') });
  const canSend = text.trim().length > 0 || pastedImages.length > 0;

  return (
    <div className="relative mx-auto w-full max-w-[980px]">
      {/* Autocomplete Menu */}
      {showMenu && (navigableItems.length > 0 || isLoadingFiles) && (
        <div
          ref={menuRef}
          className="absolute bottom-[calc(100%+14px)] left-0 right-0 z-50 max-h-[320px] overflow-y-auto rounded-[24px] border border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.98)] shadow-[0_32px_80px_rgba(28,44,73,0.16)] backdrop-blur-2xl"
        >
          {triggerChar === '@' ? (
            <>
              {menuItems.length > 0 && (
                <>
                  <div className="border-b border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-muted)]">
                    {t('composer.skills')}
                  </div>
                  {menuItems.map((item, idx) => (
                    <button
                      key={`skill-${item.name}`}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                        idx === selectedIdx ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-raised)]',
                      )}
                      onMouseDown={(e) => { e.preventDefault(); insertItem(item); }}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--app-text)]">@{item.name}</div>
                        {item.description && (
                          <div className="mt-0.5 line-clamp-1 text-xs text-[var(--app-text-muted)]">{item.description}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}

              <div className="border-y border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-muted)]">
                {t('composer.files')}
              </div>
              {fileItems.length > 0 ? (
                fileItems.map((item, rawIdx) => {
                  const globalIdx = menuItems.length + rawIdx;
                  return (
                    <button
                      key={`file-${item.description}`}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                        globalIdx === selectedIdx ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-raised)]',
                      )}
                      onMouseDown={(e) => { e.preventDefault(); insertItem(item); }}
                      onMouseEnter={() => setSelectedIdx(globalIdx)}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--app-text)]">{item.name}</div>
                        <div className="mt-0.5 line-clamp-1 text-xs text-[var(--app-text-muted)]">{item.description}</div>
                      </div>
                    </button>
                  );
                })
              ) : isLoadingFiles ? (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--app-text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('composer.searchFiles')}
                </div>
              ) : (
                <div className="px-4 py-3 text-xs text-[var(--app-text-muted)]">
                  {query ? t('composer.noFiles') : t('composer.typeToSearchFiles')}
                </div>
              )}
            </>
          ) : (
            navigableItems.map((item, idx) => (
              <button
                key={`${item.type}-${item.name}`}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  idx === selectedIdx ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-raised)]',
                )}
                onMouseDown={(e) => { e.preventDefault(); insertItem(item); }}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--app-text)]">/{item.name}</div>
                  {item.description && (
                    <div className="mt-0.5 line-clamp-1 text-xs text-[var(--app-text-muted)]">{item.description}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <div className="chat-composer-frame relative overflow-hidden">
        {pastedImages.length > 0 && (
          <div className="border-b border-[var(--app-border-soft)] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap gap-3">
              {pastedImages.map(img => (
                <div key={img.id} className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)]">
                  <Image
                    src={img.dataUrl}
                    alt="Pasted"
                    width={80}
                    height={80}
                    unoptimized
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute inset-x-1 bottom-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => setPastedImages(prev => prev.filter(p => p.id !== img.id))}
                  >
                    {t('composer.remove')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
          <div className="rounded-[24px] border border-[var(--app-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,250,255,0.96)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-all duration-200 focus-within:border-[var(--app-border-strong)] focus-within:shadow-[0_0_0_3px_rgba(47,109,246,0.10)] sm:px-5 sm:py-4">
            <Textarea
              ref={ref}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKey}
              onPaste={handlePaste}
              onBlur={() => setTimeout(() => setShowMenu(false), 150)}
              placeholder={t('composer.placeholder')}
              className="min-h-[96px] max-h-[240px] w-full resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-7 text-[var(--app-text)] shadow-none placeholder:text-[var(--app-text-muted)] focus-visible:border-transparent focus-visible:ring-0 md:text-[15px]"
              disabled={disabled}
              rows={3}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3.5 text-[11px] font-medium text-[var(--app-text-soft)]">
                <span className={cn(
                  'h-2 w-2 rounded-full',
                  connected ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : 'bg-destructive shadow-[0_0_0_4px_rgba(248,113,113,0.12)]',
                )} />
                {connected ? t('composer.connected') : t('composer.disconnected')}
              </div>

              {onAgenticModeChange && (
                <button
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[11px] font-semibold transition-all',
                    agenticMode
                      ? 'border-indigo-400/18 bg-indigo-400/10 text-indigo-700 hover:bg-indigo-400/16'
                      : 'border-violet-400/18 bg-violet-400/10 text-violet-700 hover:bg-violet-400/16',
                  )}
                  onClick={() => onAgenticModeChange(!agenticMode)}
                  title={agenticMode ? t('composer.planningHint') : t('composer.fastHint')}
                >
                  {agenticMode ? (
                    <><Rocket className="h-3.5 w-3.5" /> {t('composer.planning')}</>
                  ) : (
                    <><Zap className="h-3.5 w-3.5" /> {t('composer.fast')}</>
                  )}
                </button>
              )}

              {isRunning && (
                <div className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-400/18 bg-amber-400/10 px-3.5 text-[11px] font-medium text-amber-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  {t('composer.running')}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {models && models.length > 0 && onModelChange && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex h-11 w-full items-center justify-between gap-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 text-[12px] font-medium text-[var(--app-text-soft)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)] sm:w-[260px]"
                    title={t('composer.chooseModel')}
                  >
                    <span className="truncate">{currentLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem
                      onClick={() => onModelChange('MODEL_AUTO')}
                      className={cn('flex justify-between gap-2 font-semibold text-emerald-600 dark:text-emerald-400', currentModel === 'MODEL_AUTO' && 'bg-accent')}
                    >
                      <span className="truncate">{t('composer.autoSelect')}</span>
                    </DropdownMenuItem>

                    {models.map(m => {
                      const val = m.modelOrAlias?.model || '';
                      const pct = m.quotaInfo?.remainingFraction != null
                        ? `${Math.round(m.quotaInfo.remainingFraction * 100)}%`
                        : '';
                      const isSelected = val === currentModel;
                      return (
                        <DropdownMenuItem
                          key={val}
                          onClick={() => onModelChange(val)}
                          className={cn('flex justify-between gap-2', isSelected && 'bg-accent')}
                        >
                          <span className="truncate">{m.label}</span>
                          {pct && (
                            <span className={cn(
                              'shrink-0 font-mono text-[10px]',
                              parseFloat(pct) > 50 ? 'text-emerald-500' : parseFloat(pct) > 20 ? 'text-amber-500' : 'text-destructive',
                            )}>
                              {pct}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {isRunning ? (
                <Button
                  variant="destructive"
                  className="h-11 min-w-[118px] rounded-[16px] gap-2"
                  onClick={onCancel}
                  aria-label={t('composer.stop')}
                  title={t('composer.stop')}
                >
                  <Square className="h-4 w-4" />
                  {t('composer.stop')}
                </Button>
              ) : (
                <Button
                  className="h-11 min-w-[118px] rounded-[16px] gap-2"
                  onClick={send}
                  disabled={disabled || !canSend}
                  aria-label={t('composer.send')}
                  title={t('composer.send')}
                >
                  <SendHorizontal className="h-4 w-4" />
                  {t('composer.send')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

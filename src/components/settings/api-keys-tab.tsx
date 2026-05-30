'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Cpu, Loader2, Save, CheckCircle2, AlertCircle, Eye, EyeOff, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { workspaceFieldClassName, workspaceOutlineActionClassName } from '@/components/ui/workspace-primitives';
import type { ProviderInventory } from '@/lib/providers/provider-availability';
import { Card, SectionTitle, FieldRow, SaveFeedback, type ApiKeyTestStatus } from '@/components/settings/shared';

function ApiKeyCard({
  title,
  isSet,
  value,
  showValue,
  placeholder,
  testStatus,
  testError,
  successMessage,
  onValueChange,
  onToggleShow,
  onTest,
}: {
  title: string;
  isSet: boolean;
  value: string;
  showValue: boolean;
  placeholder: string;
  testStatus: ApiKeyTestStatus;
  testError: string | null;
  successMessage: string;
  onValueChange: (value: string) => void;
  onToggleShow: () => void;
  onTest: () => void;
}) {
  return (
    <Card>
      <SectionTitle icon={<Key className="h-4 w-4" />}>{title}</SectionTitle>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--app-text-muted)]">状态：</span>
          {isSet ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已设置
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--app-text-muted)]">
              <AlertCircle className="h-3 w-3" />
              未设置
            </span>
          )}
        </div>

        <FieldRow label="新 Key">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={isSet ? '输入新 key 以替换' : placeholder}
                className={cn('h-8 rounded-lg pr-9 text-xs', workspaceFieldClassName)}
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-soft)]"
              >
                {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onTest}
              disabled={!value.trim() || testStatus === 'testing'}
              className={cn('shrink-0 text-xs', workspaceOutlineActionClassName)}
            >
              {testStatus === 'testing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">测试连接</span>
            </Button>
          </div>
        </FieldRow>

        {testStatus === 'ok' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {successMessage}
          </div>
        ) : null}
        {testStatus === 'invalid' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            {testError ?? 'Key 无效'}
          </div>
        ) : null}
        {testStatus === 'error' ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {testError ?? '测试失败'}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function ApiKeysTab({ onInventoryChanged }: { onInventoryChanged?: (inventory: ProviderInventory) => void }) {
  const [keyStatus, setKeyStatus] = useState<{ anthropic: boolean; openai: boolean; gemini: boolean; grok: boolean }>({
    anthropic: false,
    openai: false,
    gemini: false,
    grok: false,
  });
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [grokKey, setGrokKey] = useState('');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGrokKey, setShowGrokKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [openaiTestStatus, setOpenaiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [openaiTestError, setOpenaiTestError] = useState<string | null>(null);
  const [geminiTestStatus, setGeminiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [geminiTestError, setGeminiTestError] = useState<string | null>(null);
  const [grokTestStatus, setGrokTestStatus] = useState<'idle' | 'testing' | 'ok' | 'invalid' | 'error'>('idle');
  const [grokTestError, setGrokTestError] = useState<string | null>(null);
  const [providerInventory, setProviderInventory] = useState<ProviderInventory | null>(null);

  const loadKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const data = (await res.json()) as ProviderInventory;
        setProviderInventory(data);
        onInventoryChanged?.(data);
        setKeyStatus({
          anthropic: data.anthropic.set,
          openai: data.openai.set,
          gemini: data.gemini.set,
          grok: data.grok.set,
        });
      }
    } catch {
      // silent
    }
  }, [onInventoryChanged]);

  useEffect(() => {
    void loadKeyStatus();
  }, [loadKeyStatus]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const body: { anthropic?: string; openai?: string; gemini?: string; grok?: string } = {};
      if (anthropicKey) body.anthropic = anthropicKey;
      if (openaiKey) body.openai = openaiKey;
      if (geminiKey) body.gemini = geminiKey;
      if (grokKey) body.grok = grokKey;

      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setAnthropicKey('');
      setOpenaiKey('');
      setGeminiKey('');
      setGrokKey('');
      await loadKeyStatus();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAnthropicKey = async () => {
    const keyToTest = anthropicKey.trim();
    if (!keyToTest) return;
    setTestStatus('testing');
    setTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setTestStatus('ok');
      } else if (data.status === 'invalid') {
        setTestStatus('invalid');
        setTestError(data.error ?? 'Invalid key');
      } else {
        setTestStatus('error');
        setTestError(data.error ?? 'Test failed');
      }
    } catch {
      setTestStatus('error');
      setTestError('Network error');
    }
    setTimeout(() => setTestStatus('idle'), 5000);
  };

  const handleTestOpenaiKey = async () => {
    const keyToTest = openaiKey.trim();
    if (!keyToTest) return;
    setOpenaiTestStatus('testing');
    setOpenaiTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setOpenaiTestStatus('ok');
      } else if (data.status === 'invalid') {
        setOpenaiTestStatus('invalid');
        setOpenaiTestError(data.error ?? 'Invalid key');
      } else {
        setOpenaiTestStatus('error');
        setOpenaiTestError(data.error ?? 'Test failed');
      }
    } catch {
      setOpenaiTestStatus('error');
      setOpenaiTestError('Network error');
    }
    setTimeout(() => setOpenaiTestStatus('idle'), 5000);
  };

  const handleTestGeminiKey = async () => {
    const keyToTest = geminiKey.trim();
    if (!keyToTest) return;
    setGeminiTestStatus('testing');
    setGeminiTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setGeminiTestStatus('ok');
      } else if (data.status === 'invalid') {
        setGeminiTestStatus('invalid');
        setGeminiTestError(data.error ?? 'Invalid key');
      } else {
        setGeminiTestStatus('error');
        setGeminiTestError(data.error ?? 'Test failed');
      }
    } catch {
      setGeminiTestStatus('error');
      setGeminiTestError('Network error');
    }
    setTimeout(() => setGeminiTestStatus('idle'), 5000);
  };

  const handleTestGrokKey = async () => {
    const keyToTest = grokKey.trim();
    if (!keyToTest) return;
    setGrokTestStatus('testing');
    setGrokTestError(null);
    try {
      const res = await fetch('/api/api-keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'grok', apiKey: keyToTest }),
      });
      const data = (await res.json()) as { status: string; error?: string };
      if (data.status === 'ok') {
        setGrokTestStatus('ok');
      } else if (data.status === 'invalid') {
        setGrokTestStatus('invalid');
        setGrokTestError(data.error ?? 'Invalid key');
      } else {
        setGrokTestStatus('error');
        setGrokTestError(data.error ?? 'Test failed');
      }
    } catch {
      setGrokTestStatus('error');
      setGrokTestError('Network error');
    }
    setTimeout(() => setGrokTestStatus('idle'), 5000);
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={<Key className="h-4 w-4" />}>凭证中心</SectionTitle>
        <div className="text-xs leading-6 text-[var(--app-text-soft)]">
          首次接入建议直接在 `Provider 配置` 中完成。这里用于集中轮换和维护所有 API 凭证。
        </div>
      </Card>

      <ApiKeyCard
        title="Anthropic API Key"
        isSet={keyStatus.anthropic}
        value={anthropicKey}
        showValue={showAnthropicKey}
        placeholder="sk-ant-..."
        testStatus={testStatus}
        testError={testError}
        successMessage="连接成功，Key 有效"
        onValueChange={(value) => {
          setAnthropicKey(value);
          setTestStatus('idle');
        }}
        onToggleShow={() => setShowAnthropicKey((value) => !value)}
        onTest={handleTestAnthropicKey}
      />

      <ApiKeyCard
        title="OpenAI API Key"
        isSet={keyStatus.openai}
        value={openaiKey}
        showValue={showOpenaiKey}
        placeholder="sk-..."
        testStatus={openaiTestStatus}
        testError={openaiTestError}
        successMessage="连接成功，Key 有效"
        onValueChange={(value) => {
          setOpenaiKey(value);
          setOpenaiTestStatus('idle');
        }}
        onToggleShow={() => setShowOpenaiKey((value) => !value)}
        onTest={handleTestOpenaiKey}
      />

      <Card>
        <SectionTitle icon={<Cpu className="h-4 w-4" />}>本地登录态</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">Codex Native</div>
                <div className="mt-1 text-xs text-[var(--app-text-soft)]">读取 `~/.codex/auth.json`，复用本机 Codex 登录。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.nativeCodex.loggedIn
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.nativeCodex.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)]',
              )}>
                {providerInventory?.providers.nativeCodex.loggedIn ? 'Ready' : providerInventory?.providers.nativeCodex.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              {providerInventory?.providers.nativeCodex.loggedIn
                ? '已检测到 Codex OAuth 登录，可以直接应用为默认或 layer provider。'
                : providerInventory?.providers.nativeCodex.installed
                  ? '检测到 codex 命令，但未找到 auth.json。请先在终端完成 codex 登录。'
                  : '当前未检测到 codex 可执行文件。'}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--app-text)]">Claude Code</div>
                <div className="mt-1 text-xs text-[var(--app-text-soft)]">本地 Claude Code CLI / profile 状态检测。</div>
              </div>
              <span className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : providerInventory?.providers.claudeCode.installed
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)]',
              )}>
                {providerInventory?.providers.claudeCode.installed && providerInventory?.providers.claudeCode.loginDetected ? 'Ready' : providerInventory?.providers.claudeCode.installed ? 'Needs Login' : 'Not Installed'}
              </span>
            </div>
            <div className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              {providerInventory?.providers.claudeCode.installed
                ? (providerInventory?.providers.claudeCode.loginDetected
                  ? '已检测到本地 Claude 配置，可切到 Claude Code provider。'
                  : '已检测到 Claude Code 安装，但未检测到登录配置。请先在本机 Claude Code 内完成 /login。')
                : '当前未检测到 claude CLI 或本地 Claude Code 安装。'}
            </div>
          </div>
        </div>
      </Card>

      <ApiKeyCard
        title="Gemini API Key"
        isSet={keyStatus.gemini}
        value={geminiKey}
        showValue={showGeminiKey}
        placeholder="AIza..."
        testStatus={geminiTestStatus}
        testError={geminiTestError}
        successMessage="连接成功，Gemini Key 有效"
        onValueChange={(value) => {
          setGeminiKey(value);
          setGeminiTestStatus('idle');
        }}
        onToggleShow={() => setShowGeminiKey((value) => !value)}
        onTest={handleTestGeminiKey}
      />

      <ApiKeyCard
        title="Grok API Key"
        isSet={keyStatus.grok}
        value={grokKey}
        showValue={showGrokKey}
        placeholder="xai-..."
        testStatus={grokTestStatus}
        testError={grokTestError}
        successMessage="连接成功，Grok Key 有效"
        onValueChange={(value) => {
          setGrokKey(value);
          setGrokTestStatus('idle');
        }}
        onToggleShow={() => setShowGrokKey((value) => !value)}
        onTest={handleTestGrokKey}
      />

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || (!anthropicKey && !openaiKey && !geminiKey && !grokKey)}
          className="bg-sky-500 hover:bg-sky-400 text-white font-medium px-4"
        >
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          保存凭证
        </Button>
        <SaveFeedback saved={saved} error={saveError} />
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Bell,
  Bot,
  Building2,
  ExternalLink,
  Gamepad2,
  Hash,
  MessageCircle,
  MessagesSquare,
  Plus,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceIconFrame,
  WorkspaceSurface,
  workspaceCodeBlockClassName,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

// ─── Platform Definitions ───────────────────────────────────────

interface PlatformField {
  name: string;
  label: string;
  type: 'string' | 'boolean';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | boolean;
  secret?: boolean;
  description?: string;
}

interface PlatformDef {
  type: string;
  label: string;
  icon: typeof MessageCircle;
  setupUrl?: string;
  requiresPublicIp?: boolean;
  connection: string;
  fields: PlatformField[];
}

const PLATFORMS: PlatformDef[] = [
  {
    type: 'feishu', label: '飞书 Feishu', icon: MessagesSquare, connection: 'WebSocket',
    setupUrl: 'https://open.feishu.cn',
    fields: [
      { name: 'app_id', label: 'App ID', type: 'string', required: true, placeholder: 'cli_xxxxxx' },
      { name: 'app_secret', label: 'App Secret', type: 'string', required: true, secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*', placeholder: '* 或 user_id1,user_id2' },
      { name: 'group_reply_all', label: '群聊无需@', type: 'boolean', defaultValue: false },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
      { name: 'thread_isolation', label: '话题隔离', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'telegram', label: 'Telegram', icon: Send, connection: 'Long Polling',
    setupUrl: 'https://t.me/BotFather',
    fields: [
      { name: 'token', label: 'Bot Token', type: 'string', required: true, placeholder: '123456:ABC-DEF...', secret: true },
      { name: 'allow_from', label: '允许的用户 ID', type: 'string', defaultValue: '*', placeholder: '* 或 123456789' },
      { name: 'group_reply_all', label: '群聊无需@', type: 'boolean', defaultValue: false },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'slack', label: 'Slack', icon: MessageCircle, connection: 'Socket Mode',
    setupUrl: 'https://api.slack.com/apps',
    fields: [
      { name: 'bot_token', label: 'Bot Token', type: 'string', required: true, placeholder: 'xoxb-...', secret: true },
      { name: 'app_token', label: 'App Token', type: 'string', required: true, placeholder: 'xapp-...', secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '频道共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'dingtalk', label: '钉钉 DingTalk', icon: Bell, connection: 'Stream',
    setupUrl: 'https://open-dev.dingtalk.com',
    fields: [
      { name: 'client_id', label: 'AppKey', type: 'string', required: true },
      { name: 'client_secret', label: 'AppSecret', type: 'string', required: true, secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'discord', label: 'Discord', icon: Gamepad2, connection: 'Gateway',
    setupUrl: 'https://discord.com/developers/applications',
    fields: [
      { name: 'token', label: 'Bot Token', type: 'string', required: true, secret: true },
      { name: 'allow_from', label: '允许的用户 ID', type: 'string', defaultValue: '*' },
      { name: 'guild_id', label: 'Guild ID (可选)', type: 'string', description: '用于快速注册 Slash 命令' },
      { name: 'group_reply_all', label: '群聊无需@', type: 'boolean', defaultValue: false },
      { name: 'thread_isolation', label: '线程隔离', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'line', label: 'LINE', icon: MessageCircle, connection: 'Webhook', requiresPublicIp: true,
    setupUrl: 'https://developers.line.biz/console/',
    fields: [
      { name: 'channel_secret', label: 'Channel Secret', type: 'string', required: true, secret: true },
      { name: 'channel_token', label: 'Channel Token', type: 'string', required: true, secret: true },
      { name: 'port', label: 'Webhook 端口', type: 'string', defaultValue: '8080' },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
  {
    type: 'wecom', label: '企业微信 WeChat Work', icon: Building2, connection: 'Webhook / WebSocket',
    setupUrl: 'https://work.weixin.qq.com/wework_admin',
    fields: [
      { name: 'corp_id', label: 'Corp ID', type: 'string', required: true },
      { name: 'corp_secret', label: 'App Secret', type: 'string', required: true, secret: true },
      { name: 'agent_id', label: 'Agent ID', type: 'string', required: true, placeholder: '1000002' },
      { name: 'callback_token', label: 'Callback Token', type: 'string', required: true },
      { name: 'callback_aes_key', label: 'AES Key (43字符)', type: 'string', required: true, secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
  {
    type: 'weixin', label: '微信 Weixin', icon: Smartphone, connection: 'Long Polling',
    fields: [
      { name: 'token', label: 'iLink Token', type: 'string', required: true, secret: true, description: '通过 cc-connect weixin setup 获取' },
      { name: 'base_url', label: 'Base URL', type: 'string', defaultValue: 'https://ilinkai.weixin.qq.com' },
      { name: 'account_id', label: 'Account ID', type: 'string' },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
  {
    type: 'qq', label: 'QQ (OneBot)', icon: Hash, connection: 'WebSocket',
    setupUrl: 'https://github.com/NapNeko/NapCatQQ',
    fields: [
      { name: 'ws_url', label: 'WebSocket URL', type: 'string', required: true, placeholder: 'ws://127.0.0.1:3001' },
      { name: 'token', label: 'Access Token (可选)', type: 'string', secret: true },
      { name: 'allow_from', label: '允许的 QQ 号', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'qqbot', label: 'QQ 官方机器人', icon: Bot, connection: 'WebSocket',
    setupUrl: 'https://q.qq.com',
    fields: [
      { name: 'app_id', label: 'App ID', type: 'string', required: true },
      { name: 'app_secret', label: 'App Secret', type: 'string', required: true, secret: true },
      { name: 'sandbox', label: '沙箱模式', type: 'boolean', defaultValue: false },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
];

// ─── Types ──────────────────────────────────────────────────────

interface ConnectedPlatform {
  type: string;
  connected: boolean;
}

interface PlatformManagerProps {
  platforms: ConnectedPlatform[];
  projectName: string;
  onRefresh: () => void;
}

// ─── TOML Generation ────────────────────────────────────────────

function generateTomlBlock(platformType: string, values: Record<string, string | boolean>): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('[[projects.platforms]]');
  lines.push(`type = "${platformType}"`);
  lines.push('');
  lines.push('[projects.platforms.options]');

  for (const [key, val] of Object.entries(values)) {
    if (val === '' || val === undefined) continue;
    if (typeof val === 'boolean') {
      lines.push(`${key} = ${val}`);
    } else {
      lines.push(`${key} = "${val}"`);
    }
  }

  return lines.join('\n');
}

// ─── Component ──────────────────────────────────────────────────

export default function PlatformManager({ platforms }: PlatformManagerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [tomlOutput, setTomlOutput] = useState('');

  const selectedDef = PLATFORMS.find(p => p.type === selectedType);

  // Already connected platform types
  const connectedTypes = new Set(platforms.map(p => p.type));

  const handleSelectPlatform = useCallback((type: string) => {
    setSelectedType(type);
    const def = PLATFORMS.find(p => p.type === type);
    if (def) {
      const defaults: Record<string, string | boolean> = {};
      for (const f of def.fields) {
        defaults[f.name] = f.defaultValue ?? (f.type === 'boolean' ? false : '');
      }
      setFieldValues(defaults);
    }
    setTomlOutput('');
  }, []);

  const handleFieldChange = useCallback((name: string, value: string | boolean) => {
    setFieldValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleGenerate = useCallback(() => {
    if (!selectedType) return;
    const toml = generateTomlBlock(selectedType, fieldValues);
    setTomlOutput(toml);
  }, [selectedType, fieldValues]);

  const handleCopyAndClose = useCallback(async () => {
    if (tomlOutput) {
      await navigator.clipboard.writeText(tomlOutput);
    }
    setAddOpen(false);
    setSelectedType('');
    setFieldValues({});
    setTomlOutput('');
  }, [tomlOutput]);

  const isValid = selectedDef?.fields
    .filter(f => f.required)
    .every(f => {
      const v = fieldValues[f.name];
      return typeof v === 'boolean' ? true : !!v;
    }) ?? false;

  return (
    <div>
      {/* Current platforms */}
      <div className="space-y-2 mb-4">
        {platforms.length === 0 ? (
          <WorkspaceEmptyBlock title="暂无已配置的平台" className="py-5" />
        ) : (
          platforms.map(p => {
            const def = PLATFORMS.find(d => d.type === p.type);
            const Icon = def?.icon || MessageCircle;
            return (
              <WorkspaceSurface key={p.type} padding="sm" className="flex items-center justify-between rounded-lg">
                <div className="flex items-center gap-2">
                  <WorkspaceIconFrame className="h-8 w-8 rounded-xl">
                    <Icon className="h-4 w-4" />
                  </WorkspaceIconFrame>
                  <span className="text-xs text-[var(--app-text)]">{def?.label ?? p.type}</span>
                  <WorkspaceBadge tone={p.connected ? 'success' : 'danger'}>
                    {p.connected ? '已连接' : '未连接'}
                  </WorkspaceBadge>
                </div>
                {p.connected ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-700" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-red-700" />
                )}
              </WorkspaceSurface>
            );
          })
        )}
      </div>

      {/* Add platform button */}
      <Button
        variant="outline"
        size="sm"
        className={cn('w-full border-dashed', workspaceOutlineActionClassName)}
        onClick={() => setAddOpen(true)}
      >
        <Plus className="mr-1.5 h-3 w-3" />
        添加消息平台
      </Button>

      {/* Add platform dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
          <DialogHeader>
            <DialogTitle className="text-sm">添加消息平台</DialogTitle>
            <DialogDescription className="text-xs text-[var(--app-text-muted)]">选择平台并填写凭证。</DialogDescription>
          </DialogHeader>

          {/* Platform selector */}
          <div className="grid grid-cols-5 gap-1.5 my-3">
            {PLATFORMS.map(p => {
              const Icon = p.icon;
              return (
                <button
                  key={p.type}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] transition-colors',
                    selectedType === p.type
                      ? 'border-sky-400/50 bg-sky-400/10 text-sky-700'
                      : connectedTypes.has(p.type)
                        ? 'cursor-default border-emerald-400/20 bg-emerald-400/5 text-[var(--app-text-muted)]'
                        : 'border-[var(--app-border-soft)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]',
                  )}
                  onClick={() => !connectedTypes.has(p.type) && handleSelectPlatform(p.type)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="leading-tight">{p.label.split(' ')[0]}</span>
                  {connectedTypes.has(p.type) && <span className="text-[8px] text-emerald-700">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Config form */}
          {selectedDef && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <selectedDef.icon className="h-4 w-4 text-[var(--app-accent)]" />
                  <span className="text-xs font-medium">{selectedDef.label}</span>
                  <Badge variant="outline" className="border-[var(--app-border-soft)] text-[10px] text-[var(--app-text-muted)]">
                    {selectedDef.connection}
                  </Badge>
                </div>
                {selectedDef.setupUrl && (
                  <a
                    href={selectedDef.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
                  >
                    创建 <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {selectedDef.requiresPublicIp && (
                <div className="rounded border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] text-amber-700">
                  此平台需要公网 IP 或域名（Webhook 模式）
                </div>
              )}

              {selectedDef.fields.map(field => (
                <div key={field.name} className="space-y-1">
                  <label className="flex items-center gap-1 text-[11px] text-[var(--app-text-soft)]">
                    {field.label}
                    {field.required && <span className="text-red-400">*</span>}
                  </label>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={fieldValues[field.name] as boolean ?? false}
                        onChange={(e) => handleFieldChange(field.name, e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--app-border-soft)] bg-[var(--app-raised)] accent-sky-500"
                      />
                      <span className="text-[10px] text-[var(--app-text-muted)]">{field.description}</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        type={field.secret && !showSecret[field.name] ? 'password' : 'text'}
                        value={fieldValues[field.name] as string ?? ''}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className={cn('h-8 pr-8 text-xs', workspaceFieldClassName)}
                      />
                      {field.secret && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                          onClick={() => setShowSecret(prev => ({ ...prev, [field.name]: !prev[field.name] }))}
                        >
                          <span className="text-[10px]">{showSecret[field.name] ? '隐藏' : '显示'}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {field.description && field.type !== 'boolean' && (
                    <p className="text-[10px] text-[var(--app-text-muted)]">{field.description}</p>
                  )}
                </div>
              ))}

              {/* Generate button */}
              <Button
                size="sm"
                className="w-full"
                disabled={!isValid}
                onClick={handleGenerate}
              >
                生成配置
              </Button>

              {/* TOML output */}
              {tomlOutput && (
                <div className="space-y-2">
                  <pre className={cn('overflow-x-auto whitespace-pre text-[11px] text-emerald-700', workspaceCodeBlockClassName)}>
                    {tomlOutput}
                  </pre>
                  <p className="text-[10px] text-[var(--app-text-muted)]">
                    将以上配置追加到 <code className="text-sky-400">~/.cc-connect/config.toml</code> 然后重启 cc-connect
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            {tomlOutput && (
              <Button size="sm" onClick={handleCopyAndClose}>
                复制配置并关闭
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

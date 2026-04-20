'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  ExternalLink,
  Loader2,
  Plus,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  emoji: string;
  setupUrl?: string;
  requiresPublicIp?: boolean;
  connection: string;
  fields: PlatformField[];
}

const PLATFORMS: PlatformDef[] = [
  {
    type: 'feishu', label: '飞书 Feishu', emoji: '🐦', connection: 'WebSocket',
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
    type: 'telegram', label: 'Telegram', emoji: '✈️', connection: 'Long Polling',
    setupUrl: 'https://t.me/BotFather',
    fields: [
      { name: 'token', label: 'Bot Token', type: 'string', required: true, placeholder: '123456:ABC-DEF...', secret: true },
      { name: 'allow_from', label: '允许的用户 ID', type: 'string', defaultValue: '*', placeholder: '* 或 123456789' },
      { name: 'group_reply_all', label: '群聊无需@', type: 'boolean', defaultValue: false },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'slack', label: 'Slack', emoji: '💬', connection: 'Socket Mode',
    setupUrl: 'https://api.slack.com/apps',
    fields: [
      { name: 'bot_token', label: 'Bot Token', type: 'string', required: true, placeholder: 'xoxb-...', secret: true },
      { name: 'app_token', label: 'App Token', type: 'string', required: true, placeholder: 'xapp-...', secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '频道共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'dingtalk', label: '钉钉 DingTalk', emoji: '🔔', connection: 'Stream',
    setupUrl: 'https://open-dev.dingtalk.com',
    fields: [
      { name: 'client_id', label: 'AppKey', type: 'string', required: true },
      { name: 'client_secret', label: 'AppSecret', type: 'string', required: true, secret: true },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'discord', label: 'Discord', emoji: '🎮', connection: 'Gateway',
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
    type: 'line', label: 'LINE', emoji: '🟢', connection: 'Webhook', requiresPublicIp: true,
    setupUrl: 'https://developers.line.biz/console/',
    fields: [
      { name: 'channel_secret', label: 'Channel Secret', type: 'string', required: true, secret: true },
      { name: 'channel_token', label: 'Channel Token', type: 'string', required: true, secret: true },
      { name: 'port', label: 'Webhook 端口', type: 'string', defaultValue: '8080' },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
  {
    type: 'wecom', label: '企业微信 WeChat Work', emoji: '🏢', connection: 'Webhook / WebSocket',
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
    type: 'weixin', label: '微信 Weixin', emoji: '💚', connection: 'Long Polling',
    fields: [
      { name: 'token', label: 'iLink Token', type: 'string', required: true, secret: true, description: '通过 cc-connect weixin setup 获取' },
      { name: 'base_url', label: 'Base URL', type: 'string', defaultValue: 'https://ilinkai.weixin.qq.com' },
      { name: 'account_id', label: 'Account ID', type: 'string' },
      { name: 'allow_from', label: '允许的用户', type: 'string', defaultValue: '*' },
    ],
  },
  {
    type: 'qq', label: 'QQ (OneBot)', emoji: '🐧', connection: 'WebSocket',
    setupUrl: 'https://github.com/NapNeko/NapCatQQ',
    fields: [
      { name: 'ws_url', label: 'WebSocket URL', type: 'string', required: true, placeholder: 'ws://127.0.0.1:3001' },
      { name: 'token', label: 'Access Token (可选)', type: 'string', secret: true },
      { name: 'allow_from', label: '允许的 QQ 号', type: 'string', defaultValue: '*' },
      { name: 'share_session_in_channel', label: '群聊共享会话', type: 'boolean', defaultValue: false },
    ],
  },
  {
    type: 'qqbot', label: 'QQ 官方机器人', emoji: '🤖', connection: 'WebSocket',
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

export default function PlatformManager({ platforms, projectName, onRefresh }: PlatformManagerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
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
          <p className="text-xs text-white/30 text-center py-3">暂无已配置的平台</p>
        ) : (
          platforms.map(p => {
            const def = PLATFORMS.find(d => d.type === p.type);
            return (
              <div key={p.type} className="flex items-center justify-between rounded-lg border border-white/6 bg-white/[0.015] p-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{def?.emoji ?? '📱'}</span>
                  <span className="text-xs text-white/70">{def?.label ?? p.type}</span>
                  <Badge variant="outline" className={cn(
                    'text-[10px]',
                    p.connected ? 'text-emerald-400 border-emerald-400/30' : 'text-red-400 border-red-400/30',
                  )}>
                    {p.connected ? '已连接' : '未连接'}
                  </Badge>
                </div>
                {p.connected ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-400/60" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-red-400/40" />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add platform button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full border-dashed border-white/10 text-white/50 hover:text-white/70"
        onClick={() => setAddOpen(true)}
      >
        <Plus className="mr-1.5 h-3 w-3" />
        添加消息平台
      </Button>

      {/* Add platform dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg bg-[#0a0a14] border-white/10 text-white max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">添加消息平台</DialogTitle>
            <DialogDescription className="text-xs text-white/40">
              选择平台并填写凭证，生成配置后添加到 cc-connect config.toml
            </DialogDescription>
          </DialogHeader>

          {/* Platform selector */}
          <div className="grid grid-cols-5 gap-1.5 my-3">
            {PLATFORMS.map(p => (
              <button
                key={p.type}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] transition-colors',
                  selectedType === p.type
                    ? 'border-sky-400/50 bg-sky-400/10 text-sky-300'
                    : connectedTypes.has(p.type)
                      ? 'border-emerald-400/20 bg-emerald-400/5 text-white/40 cursor-default'
                      : 'border-white/8 hover:border-white/20 text-white/50',
                )}
                onClick={() => !connectedTypes.has(p.type) && handleSelectPlatform(p.type)}
              >
                <span className="text-lg">{p.emoji}</span>
                <span className="leading-tight">{p.label.split(' ')[0]}</span>
                {connectedTypes.has(p.type) && <span className="text-[8px] text-emerald-400">✓</span>}
              </button>
            ))}
          </div>

          {/* Config form */}
          {selectedDef && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{selectedDef.emoji}</span>
                  <span className="text-xs font-medium">{selectedDef.label}</span>
                  <Badge variant="outline" className="text-[10px] text-white/30 border-white/10">
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
                <div className="rounded border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] text-amber-300">
                  ⚠️ 此平台需要公网 IP 或域名（Webhook 模式）
                </div>
              )}

              {selectedDef.fields.map(field => (
                <div key={field.name} className="space-y-1">
                  <label className="text-[11px] text-white/50 flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-red-400">*</span>}
                  </label>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={fieldValues[field.name] as boolean ?? false}
                        onChange={(e) => handleFieldChange(field.name, e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-white/5 accent-sky-400"
                      />
                      <span className="text-[10px] text-white/30">{field.description}</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        type={field.secret && !showSecret[field.name] ? 'password' : 'text'}
                        value={fieldValues[field.name] as string ?? ''}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className="h-8 text-xs bg-white/5 border-white/10 pr-8"
                      />
                      {field.secret && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/50"
                          onClick={() => setShowSecret(prev => ({ ...prev, [field.name]: !prev[field.name] }))}
                        >
                          <span className="text-[10px]">{showSecret[field.name] ? '隐藏' : '显示'}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {field.description && field.type !== 'boolean' && (
                    <p className="text-[10px] text-white/25">{field.description}</p>
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
                  <pre className="rounded-lg bg-black/40 border border-white/8 p-3 text-[11px] text-emerald-300 font-mono overflow-x-auto whitespace-pre">
                    {tomlOutput}
                  </pre>
                  <p className="text-[10px] text-white/30">
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

# security-core 包维护指南

## 概述

`@anthropic-claude/security-core` 是从 claude-code 提取的安全模块独立包，供 Antigravity-Mobility-CLI 复用。

### 包含模块

| 文件 | 来源 | 说明 |
|:-----|:-----|:-----|
| `bashSecurity.ts` | `src/tools/BashTool/bashSecurity.ts` | 23 种 bash 安全验证器 |
| `heredoc.ts` | `src/utils/bash/heredoc.ts` | Heredoc 解析/注入防护 |
| `shellQuote.ts` | `src/utils/bash/shellQuote.ts` | shell-quote 安全封装 |
| `permissions.ts` | `src/types/permissions.ts` | 权限类型定义（去依赖版） |
| `shellRuleMatching.ts` | `src/utils/permissions/shellRuleMatching.ts` | 权限规则匹配（精确/前缀/通配符） |
| `dangerousPatterns.ts` | `src/utils/permissions/dangerousPatterns.ts` | 危险命令模式列表 |
| `index.ts` | 新建 | 公开 API 导出 |

### 与原版的差异

| 改动 | 原因 |
|:-----|:-----|
| `logEvent` → 可选回调 `configureAnalytics()` | 去除 analytics 硬依赖 |
| 删除 `bashCommandIsSafeAsync_DEPRECATED` | 依赖 ParsedCommand/TreeSitter，复杂度高 |
| 重命名 `bashCommandIsSafe_DEPRECATED` → `bashCommandIsSafe` | 清理 API |
| `TreeSitterAnalysis` 类型内联定义 | 去除 tree-sitter 依赖 |
| `permissions.ts` 去除 `feature()` 和 SDK 类型 | 去除 bun:bundle 和 @anthropic-ai/sdk 依赖 |
| `shellQuote.ts` 中 `logError` → `console.error` | 去除内部日志模块依赖 |

---

## 当 claude-code 安全代码更新时

### 步骤 1: 对比差异

```bash
# 进入 claude-code 目录
cd /Users/darrel/Documents/claude-code

# 查看 bashSecurity.ts 的最近改动
git log --oneline -10 src/tools/BashTool/bashSecurity.ts
git log --oneline -10 src/utils/bash/heredoc.ts
git log --oneline -10 src/utils/bash/shellQuote.ts

# 如果有改动，对比差异
git diff HEAD~5 HEAD -- src/tools/BashTool/bashSecurity.ts
```

### 步骤 2: 同步更新

#### bashSecurity.ts 更新

```bash
# 方式一：重新复制整个文件（推荐：覆盖后重新应用 4 处修改）
cp src/tools/BashTool/bashSecurity.ts packages/security-core/src/bashSecurity.ts
```

然后在 `bashSecurity.ts` 顶部替换 import：

```typescript
// 原版 import（需要替换的）：
import { logEvent } from 'src/services/analytics/index.js'
import { extractHeredocs } from '../../utils/bash/heredoc.js'
import { ParsedCommand } from '../../utils/bash/ParsedCommand.js'
import { ... } from '../../utils/bash/shellQuote.js'
import type { TreeSitterAnalysis } from '../../utils/bash/treeSitterAnalysis.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'

// 替换为：
import { extractHeredocs } from './heredoc.js'
import { hasMalformedTokens, hasShellQuoteSingleQuoteBug, tryParseShellCommand } from './shellQuote.js'
import type { PermissionResult } from './permissions.js'

let _logEvent: (eventName: string, data?: Record<string, unknown>) => void = () => {}
export function configureAnalytics(logFn: ...) { _logEvent = logFn }
const logEvent = (name: string, data?: Record<string, unknown>) => _logEvent(name, data)

type TreeSitterAnalysis = { ... } // 内联定义
```

然后删除文件末尾的 `bashCommandIsSafeAsync_DEPRECATED` 函数（从 `export async function bashCommandIsSafeAsync_DEPRECATED` 开始到文件结束）。

重命名 `bashCommandIsSafe_DEPRECATED` → `bashCommandIsSafe`：
```bash
sed -i '' 's/bashCommandIsSafe_DEPRECATED/bashCommandIsSafe/g' packages/security-core/src/bashSecurity.ts
```

#### heredoc.ts 更新

```bash
# 直接覆盖（无修改需求）
cp src/utils/bash/heredoc.ts packages/security-core/src/heredoc.ts
```

#### shellQuote.ts 更新

需要替换 2 处 import：
- `import { logError } from '../log.js'` → `console.error`
- `import { jsonStringify } from '../slowOperations.js'` → `JSON.stringify`

### 步骤 3: 运行测试

```bash
# 1. 包自身测试
cd /Users/darrel/Documents/claude-code
bun test packages/security-core/__tests__/security.test.ts

# 2. claude-code 全量回归
bun test

# 3. Antigravity 集成测试
cd /Users/darrel/Documents/Antigravity-Mobility-CLI
npx vitest run src/lib/claude-engine/security/__tests__/bash-security-adapter.test.ts

# 4. Antigravity claude-engine 回归
npx vitest run src/lib/claude-engine/
```

### 步骤 4: 确认 TypeScript 编译

```bash
# 包编译
cd /Users/darrel/Documents/claude-code
npx tsc --noEmit -p packages/security-core/tsconfig.json

# Antigravity 编译（忽略 node_modules 错误）
cd /Users/darrel/Documents/Antigravity-Mobility-CLI
npx tsc --noEmit src/lib/claude-engine/engine/tool-executor.ts src/lib/claude-engine/security/bash-security-adapter.ts 2>&1 | grep -v "node_modules" | grep -v "claude-code/packages"
```

---

## 如果原版新增了安全验证器

如果 claude-code 的 `bashSecurity.ts` 新增了 validator 函数（如 `validateNewDangerousPattern`），需要：

1. 确认新 validator 只依赖 `ValidationContext`（文件内部类型）
2. 确认新 validator 已加入 `bashCommandIsSafe` 的 `validators` 数组
3. 如果新 validator 依赖了新的 import（如新的 utils 文件），需要决定是否也提取到 security-core
4. 在 `__tests__/security.test.ts` 中添加对应测试

## 如果原版更新了 permissions 类型

`permissions.ts` 是手动精简版。如果原版 `src/types/permissions.ts` 新增了类型字段：

1. 检查新字段是否依赖 `feature()` 或 SDK 类型
2. 如果不依赖，直接添加到 `packages/security-core/src/permissions.ts`
3. 如果依赖，用 `unknown` 或可选字段替代

---

## 文件路径快速参考

```
claude-code/
├── src/tools/BashTool/bashSecurity.ts        ← 上游源
├── src/utils/bash/heredoc.ts                 ← 上游源
├── src/utils/bash/shellQuote.ts              ← 上游源
├── src/types/permissions.ts                  ← 上游源
├── src/utils/permissions/shellRuleMatching.ts ← 上游源
├── src/utils/permissions/dangerousPatterns.ts ← 上游源
└── packages/security-core/                   ← 提取包
    ├── src/bashSecurity.ts                   ← 同步目标
    ├── src/heredoc.ts                        ← 同步目标
    ├── src/shellQuote.ts                     ← 同步目标
    ├── src/permissions.ts                    ← 同步目标
    ├── src/shellRuleMatching.ts              ← 同步目标
    ├── src/dangerousPatterns.ts              ← 同步目标
    └── __tests__/
        ├── security.test.ts                  ← 安全检查测试 (32条)
        └── ruleMatching.test.ts              ← 规则匹配测试 (24条)

Antigravity-Mobility-CLI/
├── package.json                              ← file:../claude-code/packages/security-core
└── src/lib/claude-engine/
    ├── engine/tool-executor.ts               ← 安全检查集成点
    └── security/
        ├── bash-security-adapter.ts          ← 适配层
        └── __tests__/bash-security-adapter.test.ts
```

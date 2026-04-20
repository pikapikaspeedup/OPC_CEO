# Claude Code 代码复用策略研究

**日期**: 2026-04-11
**状态**: ✅ Phase 1 已实施（安全模块提取完成）

---

## 一、现状诊断：重写 vs 复用

### 数字对比

| 模块 | claude-code | Antigravity claude-engine | 复用方式 | 代码量比 |
|:-----|:-----------|:-------------------------|:---------|:---------|
| **安全机制** | 32,399 行 (24个文件) | 4,462 行 | 完全重写 | **14%** |
| **API 客户端** | 2,000+ 行 + SDK | 260 行 | 完全重写 | **13%** |
| **查询循环** | 350 行 + 6,970行(main) | 400 行 | 完全重写 | **~5%** |
| **工具系统** | 55 工具 | 6 工具 | 重写核心 | **11%** |
| **MCP 客户端** | SDK transport | 自建 transport | 完全重写 | N/A |
| **上下文构建** | 350 行 | 100 行 | 复制精简 | **29%** |

**结论：当前 Antigravity 的 claude-engine 是 claude-code 的"精简重写版"，代码复用率接近 0%。**

### 复用率为零的根因

1. **两个项目零依赖关系** — package.json 无 cross-reference，tsconfig 无 path mapping
2. **运行时不兼容** — claude-code 是 Bun 运行时 + CLI，Antigravity 是 Next.js + Gateway
3. **模块耦合** — claude-code 的模块深度依赖内部类型（`BetaRawMessageStreamEvent`、feature flags、Ink UI），无法直接 import 使用
4. **Claude-code 不是 npm 包** — 没有发布独立的 SDK/Library 包，只发布完整 CLI

---

## 二、安全机制差距分析（最大风险）

### claude-code 安全体系：32,399 行

```
src/tools/BashTool/
├── bashSecurity.ts      (2,592 行) — 23 种安全检查
├── bashPermissions.ts   (2,621 行) — 路径/命令权限引擎
├── bashCommand.ts       — 命令解析
├── bashSpeculation.ts   — 推测执行分析
└── ... (15+ 文件)

src/utils/bash/
├── ParsedCommand.ts     — 命令 AST 解析
├── treeSitterAnalysis.ts — Tree-sitter 语法分析
├── shellQuote.ts        — Shell 引号安全
├── heredoc.ts           — Heredoc 注入防护
└── ... (6 文件)

src/utils/permissions/
├── PermissionResult.ts  — 权限判定类型
├── permissionsLoader.ts — 规则加载器
├── shellRuleMatching.ts — Shell 规则匹配
├── yoloClassifier.ts    — YOLO 模式分类器
└── ... (5 文件)
```

### Antigravity 安全体系：4,462 行

```
src/lib/claude-engine/tools/bash.ts         (180 行) — 基础命令分类
src/lib/claude-engine/permissions/checker.ts (383 行) — 简化权限检查
src/lib/security/security-guard.ts          (190 行) — 骨架，未接入执行链
src/lib/security/types.ts                   (494 行) — 策略类型定义
```

### 具体缺失

| claude-code 安全检查 | Antigravity 是否有 | 风险 |
|:--------------------|:-------------------|:-----|
| 命令替换检测 `$()` `\`\`` | ❌ 无 | **高** — AI 可能生成包含命令注入的 bash |
| Shell 元字符验证 | ❌ 仅基础正则 | **高** — 管道/重定向可绕过 |
| Zsh 危险命令阻断 | ❌ 无 | **中** — macOS 默认 Zsh |
| Heredoc 注入防护 | ❌ 无 | **中** — 复杂但真实的攻击向量 |
| Tree-sitter 语法分析 | ❌ 无 | **高** — 最准确的命令解析 |
| 路径约束（沙箱外写入） | ⚠️ 文件工具有，BashTool 无 | **高** — bash 可写任意路径 |
| YOLO 模式分类 | ❌ 无 | **低** — 功能性非安全性 |
| 混淆标志检测 | ❌ 无 | **中** — `\x72\x6d` 绕过 |
| IFS 注入检测 | ❌ 无 | **中** — 环境变量注入 |
| Unicode 空格检测 | ❌ 无 | **中** — 不可见字符攻击 |
| 控制字符检测 | ❌ 无 | **中** — 终端逃逸攻击 |
| 花括号展开检测 | ❌ 无 | **中** — `{rm,-rf,/}` |

---

## 三、可选方案

### 方案 A: 继续重写（当前路线）

**做法**: 继续在 claude-engine 中重写 claude-code 功能
**优势**: 代码干净，无外部耦合
**劣势**: 
- 安全机制永远落后于 claude-code
- 每个新功能都要重写+测试
- 重写过程容易引入漏洞（安全机制尤其危险）
**工作量**: 高，且持续

### 方案 B: 提取 claude-code 模块为 npm 包（推荐）

**做法**: 从 claude-code 中提取可独立使用的模块，在 Antigravity 中直接 import

**可提取模块**（与 UI/运行时无耦合的纯逻辑）：

| 模块 | 行数 | 外部依赖 | 提取难度 |
|:-----|:-----|:---------|:---------|
| `bashSecurity.ts` + `bashPermissions.ts` | ~5,200 | analytics（可 stub） | **低** |
| `src/utils/bash/*` (ParsedCommand, shellQuote, heredoc) | ~2,500 | 无 | **极低** |
| `src/utils/permissions/*` (PermissionResult, shellRuleMatching) | ~3,000 | 无 | **极低** |
| `src/tools/BashTool/bashCommand.ts` | ~800 | 无 | **极低** |
| MCP 工具转换 | ~500 | MCP SDK | **低** |

**具体做法**：
1. 在 claude-code 中创建 `packages/security-core/` workspace 包
2. 将纯逻辑模块移入，解耦 analytics（用回调注入替代硬编码 import）
3. 发布为 `@claude-code-best/security-core` npm 包
4. Antigravity 直接 `npm install` 使用

**优势**:
- 安全机制自动同步 claude-code 上游更新
- 零重写风险
- 维护成本极低

**劣势**:
- 需要 claude-code 做一次拆包重构
- 两个项目间产生依赖关系

### 方案 C: 直接复制+适配层（折中）

**做法**: 将 claude-code 的安全模块文件直接复制到 Antigravity，添加薄适配层

**具体做法**：
1. 复制 `bashSecurity.ts`, `bashPermissions.ts`, `src/utils/bash/*`, `src/utils/permissions/*` 到 `src/lib/claude-engine/security/upstream/`
2. 写一个 `adapter.ts` 桥接 claude-code 类型到 Antigravity 类型
3. Stub 掉 analytics/feature flag 依赖
4. 定期从 claude-code git pull 更新

**优势**: 快速获得完整安全机制
**劣势**: 手动同步，可能出现 drift

---

## 四、推荐策略：方案 B（分阶段）

### Phase 1: 安全模块提取（最高优先级）

**目标**: 从 claude-code 提取 `@claude-code-best/security-core`

**包含**:
- `bashSecurity.ts` — 23 种安全检查
- `bashPermissions.ts` — 路径/命令权限引擎
- `src/utils/bash/*` — 命令解析工具
- `src/utils/permissions/*` — 权限类型和匹配器
- Analytics 回调接口（替代硬编码 logEvent）

**不包含**:
- UI 组件
- Feature flags（转为配置项）
- Ink 渲染

### Phase 2: 工具系统提取

**目标**: 提取工具类型定义和核心工具的共享逻辑

### Phase 3: Query Loop 共享协议

**目标**: 统一 EngineEvent 类型定义，让两个项目的事件格式兼容

---

## 五、技术可行性验证

### bashSecurity.ts 的依赖分析

```typescript
// 外部 import（需要处理的）：
import { logEvent } from 'src/services/analytics/index.js'    // → 替换为回调
import { extractHeredocs } from '../../utils/bash/heredoc.js'  // → 一起提取
import { ParsedCommand } from '../../utils/bash/ParsedCommand.js'  // → 一起提取
import { hasMalformedTokens, ... } from '../../utils/bash/shellQuote.js'  // → 一起提取
import type { TreeSitterAnalysis } from '../../utils/bash/treeSitterAnalysis.js'  // → 一起提取
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'  // → 一起提取
```

**所有依赖都在 `src/utils/` 下，是纯逻辑模块，无 UI/运行时依赖。**

唯一需要 stub 的：`logEvent`（analytics），可以替换为可选回调。

### 预估工作量

| 步骤 | 工作量 |
|:-----|:------|
| 创建 `packages/security-core/` 骨架 | 30 分钟 |
| 移动文件 + 修改 import 路径 | 1 小时 |
| 用回调替换 `logEvent` | 30 分钟 |
| 添加 package.json + tsconfig | 15 分钟 |
| 在 Antigravity 中 install + 集成 | 1 小时 |
| 测试验证 | 1 小时 |
| **总计** | **~4 小时** |

---

## 六、决策矩阵

| 维度 | 方案 A (继续重写) | 方案 B (npm 包) | 方案 C (复制+适配) |
|:-----|:-----------------|:---------------|:-----------------|
| 安全性 | 🔴 持续缺失 | 🟢 完整同步 | 🟡 初始完整，渐渐 drift |
| 开发效率 | 🔴 每功能重写 | 🟢 import 即用 | 🟡 定期手动同步 |
| 维护成本 | 🔴 高 | 🟢 低 | 🟡 中 |
| 解耦性 | 🟢 完全独立 | 🟡 产生包依赖 | 🟡 文件级耦合 |
| 实施速度 | ❌ 不改 | 🟡 约 4 小时 | 🟢 约 2 小时 |
| **推荐** | ❌ | ✅ **推荐** | 🟡 过渡方案 |

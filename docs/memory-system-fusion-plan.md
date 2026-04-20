# 记忆系统架构规划：管理层 + 执行层统一模型

**日期**: 2026-04-12（v3 — 架构认知升级）
**状态**: 研究文档 — 待实施

---

## 0. 架构认知升级

### 之前的理解（❌ 已否定）

> "项目中有三套独立的记忆系统：Claude-Engine Memory（执行层）、Department Memory（运营层）、Knowledge（策展层）"

### 新的理解（✅ 正确）

**不是三套独立系统，而是一个管理层 + 多个执行层适配器。**

核心洞察：**Knowledge 和 Claude-Engine Memory 本质上都是执行层记忆，只是针对不同 Provider。**

- `~/.gemini/antigravity/knowledge/` = **Gemini Provider 的执行层记忆**（Gemini IDE 原生机制）
- `~/.gemini/antigravity/memory/` = **Codex Provider 的执行层记忆**（通过 orgMemory → baseInstructions 注入）
- `claude-engine/memory/` = **Claude Provider 的执行层记忆**（通过 MemoryStore → system prompt 注入）

而 **Department Memory** 不应该是"第四套独立记忆" — 它应该是**管理层控制面**，通过它来编辑/配置各个 Provider 的执行层记忆。

```
┌──────────────────────────────────────────────────────────┐
│  管理层 (Management Plane)                                │
│  Department Memory = 统一管理界面                          │
│                                                           │
│  CEO/部门经理 通过管理界面编辑：                           │
│    ├── 共享记忆 (decisions/patterns) → 桥接到所有 Provider │
│    ├── 给 CEO 部门的 Claude Engine 配置记忆 A             │
│    ├── 给 Engineering 部门的 Codex 配置记忆 B             │
│    └── 给 Design 部门的 Claude Engine 配置记忆 C          │
└───────────────────────┬──────────────────────────────────┘
                        │ 桥接/注入
┌───────────────────────▼──────────────────────────────────┐
│  执行层 (Data Plane)                                      │
│  每个 Provider 有自己的原生记忆格式和注入方式              │
│                                                           │
│  ┌────────────────┬──────────────────┬──────────────────┐ │
│  │ Claude Engine  │ Codex/Gemini     │ Claude Code      │ │
│  │ MemoryStore    │ orgMemory        │ CLAUDE.md        │ │
│  │ → sys prompt   │ → baseInstructs  │ → AutoMem        │ │
│  │                │ + Knowledge      │ (主动关闭)       │ │
│  └────────────────┴──────────────────┴──────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 这意味着什么？

1. **Department Memory 的新定位** — 不再是"运营级经验沉淀"，而是**记忆系统的控制面**
   - 管理共享记忆（跨 Provider 的决策/模式/知识）
   - 配置各 Provider 的执行层记忆（per-department × per-provider）

2. **Knowledge 不再是独立层** — 它是 Gemini Provider 的执行层记忆之一

3. **Claude-Engine Memory 是 Claude Provider 的执行层** — 管理层应该能通过 Department Memory 来编辑它

---

## 1. 现状分析

### 执行层记忆（各 Provider 的原生机制）

| Provider | 执行层记忆 | 位置 | 注入方式 | 状态 |
|:---------|:----------|:-----|:---------|:-----|
| Claude Engine | MemoryStore | `<project>/.claude-engine/memory/` | → system prompt | ❌ 未接线 |
| Codex/Gemini | orgMemory | `~/.gemini/antigravity/memory/` | → baseInstructions | ✅ 已注入（但目录空） |
| Gemini IDE | Knowledge | `~/.gemini/antigravity/knowledge/` | → Gemini 自动消费 | ✅ IDE 原生 |
| Claude Code | AutoMem | CLAUDE.md + memdir | → system prompt | ⚠ 主动关闭 |

### 管理层（Department Memory）

| 组件 | 位置 | 状态 |
|:-----|:-----|:-----|
| DepartmentMemory 类 | `department-memory.ts` | ✅ 读写 API 存在 |
| MemoryHooks 总线 | `memory-hooks.ts` | ✅ 骨架存在，❌ 零注册者 |
| memoryContext 字段 | `BackendRunConfig` | ✅ 定义存在，❌ 零消费者 |
| 简易提取 | `finalization.ts` | ⚠ 正则提取，非 LLM |
| API 路由 | `/api/departments/memory` | ✅ GET/POST |
| 前端 UI | `DepartmentMemoryPanel` | ✅ 只读展示 |
| **Per-Provider 配置** | — | **❌ 完全不存在** |

### 核心问题

1. **管理层没有 per-provider 配置能力** — Department Memory 只有 knowledge/decisions/patterns 三个 category，无法区分"给 Claude 的记忆"和"给 Codex 的记忆"
2. **管理层→执行层的桥接不存在** — MemoryHooks 是空架子，memoryContext 零消费者
3. **Claude Engine 执行层未接线** — MemoryStore 底座完整但没接入引擎
4. **CEO 不走 Department 合同** — CEO workspace 没有 `.department/`

### Claude-Engine Memory 底座（25 条测试全绿）

```
src/lib/claude-engine/memory/
├── memory-store.ts     — 文件读写删 + MEMORY.md ✅
├── memory-scanner.ts   — 目录扫描 + frontmatter ✅
├── memory-prompt-builder.ts — 提示模板拼装 ✅
├── memory-paths.ts     — 路径计算 ✅
├── memory-types.ts     — user/feedback/project/reference ✅
└── memory-age.ts       — mtime 新鲜度 ✅
```

---

## 2. Claude-Code 原版记忆架构（对标参考）

| 机制 | 子系统 | 作用 |
|:-----|:------|:-----|
| **指令/记忆注入层** | 6 层 CLAUDE.md 栈 | Managed/User/Project/Local/AutoMem/TeamMem |
| **内容型持久记忆** | memdir + ExtractMemories + AutoDream | topic memory + 后台提取 + sideQuery 召回 + 定期整理 |
| **旁路记忆** | AgentMemory + SessionMemory | Agent 跨 session + 会话摘要压缩替代 |

---

## 3. 新架构：管理层 + 执行层

### 目标状态的 `.department/` 目录结构

```
.department/
├── config.json              ← 部门配置
├── memory/
│   ├── shared/              ← 所有 Provider 共享的部门记忆
│   │   ├── decisions.md     ← "我们决定用 monorepo"
│   │   └── patterns.md      ← "测试优先，PR 必须有 review"
│   ├── claude-engine/       ← Claude Provider 特定的执行记忆
│   │   ├── MEMORY.md        ← 索引
│   │   ├── api-conventions.md
│   │   └── coding-style.md
│   └── codex/               ← Codex Provider 特定的执行记忆
│       └── knowledge.md     ← "项目用 TypeScript strict"
├── rules/                   ← 部门规则
└── workflows/               ← 部门工作流
```

### 管理层→执行层的桥接

```typescript
// Department Memory 管理层的职责：
// 1. 管理共享记忆（shared/）→ 桥接到所有 Provider
// 2. 管理 per-provider 记忆 → 直接写入对应 Provider 的执行层目录

// 桥接示例：
async function bridgeToExecutionLayer(
  deptConfig: DepartmentConfig,
  provider: 'claude-engine' | 'codex' | 'claude-code',
): Promise<void> {
  // 1. 读取共享记忆
  const shared = await readDepartmentSharedMemory(deptConfig.projectRoot);
  
  // 2. 读取 provider 特定记忆
  const providerMemory = await readDepartmentProviderMemory(
    deptConfig.projectRoot, provider
  );
  
  // 3. 合并并注入到对应 Provider 的执行层
  switch (provider) {
    case 'claude-engine':
      // 写入 .claude-engine/memory/ 或直接注入 system prompt
      break;
    case 'codex':
      // 写入 ~/.gemini/antigravity/memory/ 或注入 baseInstructions
      break;
    case 'claude-code':
      // 追加到 CLAUDE.md
      break;
  }
}
```

---

## 4. 实施计划（5 个阶段）

### Phase 1: Claude-Engine 执行层接线（P0）

**目标**：让 Claude Engine 的 MemoryStore 真正接入引擎主链。

**修改点**：

1. **ClaudeEngine 构造增加 memory 配置**
   ```typescript
   interface ClaudeEngineOptions {
     memory?: {
       store: MemoryStore;
       autoInject: boolean;
       includeManifest: boolean;
     };
   }
   ```

2. **ContextBuilder 增加 memory 装配** — 机制/内容分离
   - mechanicsPrompt → system prompt（"如何使用记忆系统"）
   - contentBlock → user context（MEMORY.md 内容 + 文件清单）

3. **QueryLoop 前自动装配**

**预计**：~150 行代码 + ~50 行测试

---

### Phase 1b: Department Memory 管理层→执行层桥接（P0）

**目标**：让 Department Memory 真正桥接到各 Provider 的执行层。

**修改点**：

1. **Department Memory 目录结构升级**
   ```
   .department/memory/
   ├── shared/           ← 新增：跨 provider 共享
   │   ├── decisions.md
   │   └── patterns.md
   ├── claude-engine/    ← 新增：Claude provider 特定
   └── codex/            ← 新增：Codex provider 特定
   
   # 兼容旧结构：旧的 knowledge.md/decisions.md/patterns.md
   # 自动迁移到 shared/ 下
   ```

2. **DepartmentMemoryBridge 类**
   ```typescript
   class DepartmentMemoryBridge {
     // 读取部门记忆（共享 + provider 特定），拼装给执行层
     async buildForProvider(
       projectRoot: string,
       provider: 'claude-engine' | 'codex' | 'claude-code',
     ): Promise<{ shared: string; providerSpecific: string }>;
   }
   ```

3. **注册 MemoryHook** — 在 beforeRun 时调用 Bridge，写入 memoryContext
4. **Provider 消费 memoryContext** — 至少 codex-executor 消费

**预计**：~250 行代码 + ~70 行测试

---

### Phase 2: 多层记忆发现（P1）

**目标**：Claude-Engine 支持 User/Project/Local 三层执行层记忆。

```
~/.claude-engine/memory/        ← User 层（全局偏好）
<project>/.claude-engine/memory/ ← Project 层（项目级）
<cwd>/.claude-engine/memory/     ← Local 层（当前目录）
```

**关键设计**：Department Memory 的 `per-provider/claude-engine/` 记忆会被视为额外的一层，优先级在 Project 和 Local 之间。

```
优先级：Local > Department(claude-engine) > Project > User
```

**预计**：~200 行代码 + ~60 行测试

---

### Phase 3: 统一召回层（P1）

**目标**：统一的 MemoryRecallService，从所有来源召回相关记忆。

**来源**：
- Claude-Engine Memory（多层 MemoryStore）
- Department Memory shared/（共享决策/模式）
- Department Memory per-provider/（provider 特定记忆）

**实现**：sideQuery（小模型选择相关记忆）+ 缓存 + 异步预取

**预计**：~300 行代码 + ~80 行测试

---

### Phase 4: 后台记忆提取（P2）

**目标**：对话/run 结束后自动提取记忆，写入对应层级。

- ClaudeEngine 对话 → 提取到 `claude-engine/memory/`（执行层）
- Agent run → 提取到 `.department/memory/shared/`（管理层共享）
- 升级 `extractAndPersistMemory` 从正则改为 LLM 提取

**预计**：~300 行代码 + ~80 行测试

---

### Phase 5: CEO 统一到 Department 合同（P2）

**目标**：CEO workspace 走 `.department/` 合同。

- 创建 `.department/config.json` + `.department/memory/`
- `.agents/rules/` 变为同步产物
- CEO 的 identity/playbook 移入 `.department/`

**预计**：~100 行代码 + ~30 行测试

---

## 5. 数据流全景（目标状态）

```
┌─────────────────────────────────────────────────────────┐
│  管理层: Department Memory                               │
│                                                          │    
│  UI/API 编辑                                             │
│  ┌──────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ shared/  │  │ claude-engine/ │  │ codex/          │  │
│  │decisions │  │ api-style.md   │  │ knowledge.md    │  │
│  │patterns  │  │ MEMORY.md      │  │                 │  │
│  └────┬─────┘  └──────┬─────────┘  └───────┬─────────┘  │
│       │               │                    │             │
└───────┼───────────────┼────────────────────┼─────────────┘
        │               │                    │
        ▼               ▼                    ▼
┌───────────────────────────────────────────────────────────┐
│  执行层: Provider Memories                                │
│                                                           │
│  ┌─────────────────┐  ┌────────────────┐  ┌────────────┐ │
│  │ Claude Engine   │  │ Codex/Gemini   │  │ Claude Code│ │
│  │                 │  │                │  │            │ │
│  │ shared/ +       │  │ shared/ +      │  │ (关闭)     │ │
│  │ claude-engine/  │  │ codex/ +       │  │            │ │
│  │ → system prompt │  │ orgMemory      │  │            │ │
│  │                 │  │ → baseInstruct │  │            │ │
│  └─────────────────┘  └────────────────┘  └────────────┘ │
│                                                           │
│  Phase 3: 统一召回层 (MemoryRecallService)                │
│  sideQuery → 选相关记忆 → <relevant-memories>            │
│                                                           │
│  Phase 4: 后台提取                                        │
│  对话/run 结束 → LLM 提取 → 写回管理层/执行层            │
└───────────────────────────────────────────────────────────┘
```

---

## 6. 实施优先级与预估

| Phase | 优先级 | 代码量 | 测试量 | 依赖 | 影响 |
|:------|:------|:------|:------|:-----|:-----|
| Phase 1: CE 执行层接线 | P0 | ~150 行 | ~50 行 | 无 | CE Memory 闭环 |
| Phase 1b: 管理层→执行层桥接 | P0 | ~250 行 | ~70 行 | 无 | Dept Memory 从骨架→生效 |
| Phase 2: 多层发现 | P1 | ~200 行 | ~60 行 | Phase 1 | User/Project/Local |
| Phase 3: 统一召回层 | P1 | ~300 行 | ~80 行 | Phase 1+1b+2 | 智能记忆选择 |
| Phase 4: 后台提取 | P2 | ~300 行 | ~80 行 | Phase 1 | 自动积累 |
| Phase 5: CEO 统一合同 | P2 | ~100 行 | ~30 行 | Phase 1b | 合同一致性 |
| **合计** | — | **~1300 行** | **~370 行** | — | **管理+执行完整闭环** |

---

## 7. 关键设计决策

### 7.1 为什么是"管理层 + 执行层"而不是"三套独立系统"？

| 维度 | 三套独立 | 管理+执行 |
|:-----|:--------|:---------|
| 概念模型 | 执行/运营/策展 ❌ | 控制面/数据面 ✅ |
| Knowledge 定位 | 独立策展层（错误） | Gemini 执行层（正确） |
| Department Memory | 又一套记忆 | 记忆的管理界面 |
| Per-dept per-provider | 不支持 | 自然支持 |
| CEO 的记忆 | 需要第四套？ | 只需要配置 CEO 的 provider 记忆 |

### 7.2 Department Memory 的 per-provider 目录

管理层面可以为不同部门×不同 Provider 配置不同的执行记忆：

```
Engineering/.department/memory/claude-engine/  → "use strict TypeScript"
Engineering/.department/memory/codex/          → "prefer monorepo structure"

Design/.department/memory/claude-engine/       → "follow Figma design system"
Design/.department/memory/codex/               → "use CSS-in-JS"

CEO/.department/memory/claude-engine/          → "strategic thinking mode"
```

### 7.3 共享记忆的桥接策略

`shared/` 下的记忆（decisions、patterns）自动桥接到所有 Provider：

- **Claude Engine**：拼入 system prompt 的 `<department-context>` section
- **Codex/Gemini**：追加到 baseInstructions
- **Claude Code**：追加到 CLAUDE.md（如果未关闭 AutoMem）

### 7.4 与 Transcript Persistence 的关系

- TranscriptStore = 对话原文（JSONL，用于 resume）
- 执行层记忆 = 提炼的技术知识（per-provider 格式）
- 管理层记忆 = 组织化的经验沉淀（可编辑的控制面）

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|:-----|:-----|:-----|:---------|
| 管理层→执行层桥接增加复杂度 | 中 | 多一层间接 | 保持桥接逻辑简单直接 |
| per-provider 目录爆炸 | 低 | 管理混乱 | 只支持已注册的 Provider |
| 旧 dept memory 格式迁移 | 中 | 需要迁移脚本 | 自动检测旧格式并迁移 |
| sideQuery 增加延迟/成本 | 中 | 200-500ms/turn | 异步预取 + 智能缓存 |

---

## 9. 验收标准

### Phase 1: CE 执行层接线
- [ ] `ClaudeEngine({ memory: { store, autoInject: true } })` 可用
- [ ] MEMORY.md → system prompt，文件清单 → user context
- [ ] 测试 ≥10 条

### Phase 1b: 管理层→执行层桥接
- [ ] `.department/memory/shared/` + `.department/memory/<provider>/` 目录结构
- [ ] DepartmentMemoryBridge 支持 claude-engine + codex
- [ ] MemoryHook 注册 + memoryContext 被至少 1 个 provider 消费
- [ ] 旧格式自动迁移
- [ ] 测试 ≥15 条

### Phase 2: 多层发现
- [ ] User/Project/Local + Department 四层优先级
- [ ] 测试 ≥15 条

### Phase 3: 统一召回
- [ ] 多来源 sideQuery + 缓存 + 降级
- [ ] 测试 ≥20 条

### Phase 4: 后台提取
- [ ] 自动提取到管理层/执行层
- [ ] LLM 提取替代正则
- [ ] 测试 ≥15 条

### Phase 5: CEO 统一合同
- [ ] CEO workspace 有 `.department/`
- [ ] `.agents/rules/` 变为同步产物
- [ ] 测试 ≥5 条

# Claude Code 特性 × Phase 交叉映射表

日期：2026-04-10  
状态：正式映射 / 可直接指导开发排序

## 目的

把 22 个可移植特性和 6 个开发阶段做交叉映射，明确：

1. 每个特性在哪个 Phase 首次引入
2. 哪些特性跨多个 Phase 递进深化
3. 每个 Phase 对应的测试准备
4. 哪些特性可以推迟到 Phase 6 之后

---

## 1. 总览矩阵

| # | 特性 | P0/P1/P2 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | 后续 |
|---|------|----------|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:----:|
| 1 | Provider 多模型兼容层 | P0 | **首次** | | | | | 深化 | |
| 2 | 工具系统 & 注册框架 | P0 | 最小集 | | | | **深化** | | |
| 3 | 查询引擎 & 会话循环 | P0 | **首次** | 深化 | | | | | |
| 4 | 权限系统 | P0 | | | | | **首次** | | |
| 5 | 上下文构建 & System Prompt | P0 | **首次** | | | | 深化 | | |
| 6 | 文件编辑 & Diff 管理 | P0 | 嵌入工具 | | 归一化 | | 深化 | | |
| 7 | Token 预算 & 成本控制 | P0 | | | **首次** | | | 深化 | |
| 8 | MCP 集成 | P1 | | | | | **首次** | | |
| 9 | Agent/Task 子系统 | P1 | | | | | | | **后续** |
| 10 | Plan Mode | P1 | | | | | | | **后续** |
| 11 | 会话持久化 & 恢复 | P1 | | **首次** | | 深化 | | | |
| 12 | Memory / 长期记忆 | P1 | | | | | **首次** | | |
| 13 | Bridge / Remote Control | P1 | | | | | | | **后续** |
| 14 | Skill 系统 | P2 | | | | | **首次** | | |
| 15 | Daemon / 后台会话 | P2 | | | | | | | **后续** |
| 16 | Computer Use | P2 | | | | | | | **后续** |
| 17 | Voice Mode | P2 | | | | | | | **后续** |
| 18 | SSH 远程执行 | P2 | | | | | | | **后续** |
| 19 | Server / IDE 直连 | P2 | | | | | | | **后续** |
| 20 | Auto Mode | P2 | | | | | | **首次** | |
| 21 | Worktree / 项目隔离 | P2 | | | | | | | **后续** |
| 22 | Thinking / Effort 模式 | P2 | **首次** | | | | | | |

---

## 2. 按 Phase 展开

## Phase 1：最小 executor adapter 跑通

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| Provider 多模型兼容层 | **首次** | 只接 Claude Code 作为一个新 provider/backend，走 Anthropic 第一方或 OpenAI 兼容；不同时接 7 个 |
| 查询引擎 & 会话循环 | **首次** | 把 Claude Code 的 query loop 封装在 adapter 内部，外部只看 start -> result |
| 上下文构建 | **首次** | Claude Code executor 启动时注入 CLAUDE.md / rules / workspace context |
| 文件编辑 & Diff | 嵌入工具 | Claude Code 内部自己的 FileEdit/FileWrite 能力，Phase 1 不需要额外改造 |
| Thinking / Effort | **首次** | Claude Code executor 内部已有 thinking mode，Phase 1 直接透传即可 |
| 工具系统 | 最小集 | Claude Code 自带 55+ 工具，Phase 1 只确保 Bash/FileEdit/FileRead/Grep/Glob 能跑通 |

### Phase 1 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| Claude Code provider 解析 | 单测 | ai-config 能把 stage 路由到 claude-code |
| Claude Code backend started -> completed | 单测 | backend 正常完成一次执行 |
| Claude Code backend started -> failed | 单测 | 执行失败能正确归一化成 TaskResult |
| RunRegistry 持久化 | 单测 | providerId / externalHandle 正确回写 |
| legacy-single coding stage e2e | 集成 | 一个 coding stage 跑通完整主链 |
| 工具基线（Bash/FileEdit/Grep） | 冒烟 | Claude 内部工具能正常工作 |

---

## Phase 2：Session / Conversation 映射稳定化

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| 会话持久化 & 恢复 | **首次** | Claude session handle / transcript path 持久化到 Run provenance |
| 查询引擎 | 深化 | session resume / continue 能力接入 |

### Phase 2 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| Run provenance round-trip | 单测 | 写入后读出不丢字段 |
| provider 配置漂移后 attach 仍命中原 backend | 单测 | provenance-first |
| attach 失败显式报错 | 单测 | 不静默降级 |
| old handle 晚到事件不覆盖新 handle | 单测 | supersede 安全 |

---

## Phase 3：事件 / 结果归一化

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| Token 预算 & 成本控制 | **首次** | 从 Claude Code 的 query loop 拿到 token usage，归一化写入 Run 成本记录 |
| 文件编辑 & Diff | 归一化 | changedFiles 从 Claude tool result 中提取并归一化 |

### Phase 3 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| event normalization | 单测 | Claude event → 平台 Step / liveState |
| tool 分类 | 单测 | file_write / bash / mcp 等工具分类正确 |
| result normalization | 单测 | summary / changedFiles / blockers 正确映射 |
| token usage extraction | 单测 | input/output token 正确统计 |
| backend integration started -> live_state -> completed | 集成 | 完整生命周期 |
| finalization / artifact trace | 回归 | raw trace 落盘不影响平台 result |

---

## Phase 4：Intervention 能力补齐

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| 会话持久化 & 恢复 | 深化 | attach / resume 能力打通，支持 nudge / cancel |

### Phase 4 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| active append | 单测 | 活跃 session 追加消息 |
| unattached attach 后 append | 单测 | 通过 provenance 恢复后追加 |
| attach unsupported 显式失败 | 单测 | 不支持的 backend 不静默 |
| active cancel 后晚到 completion 被抑制 | 单测 | 取消语义正确 |
| evaluate success / failed / cancelled / malformed | 单测 | 4 种诊断终态 |
| attached-session timeout / superseded | 单测 | 超时和替代语义 |

---

## Phase 5：Tool / Permission / Artifact 深化整合

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| 权限系统 | **首次** | Claude 内部 permission 事件映射到平台 permission_request |
| 工具系统 | 深化 | 从 Phase 1 的最小工具集扩展到完整 55+ 工具 |
| MCP 集成 | **首次** | Claude Code 的 MCP client 能力接入，支持外部 MCP server |
| Memory / 长期记忆 | **首次** | Claude Code 的 memdir / session memory 接入上下文管道 |
| Skill 系统 | **首次** | Claude Code 的 SkillTool 接入 |
| 文件编辑 & Diff | 深化 | 冲突检测、文件历史快照、attribution 深化 |
| 上下文构建 | 深化 | memory files / CLAUDE.md 分层发现完整化 |

### Phase 5 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| backend permission bridge | 单测 | Claude permission event → 平台 permission_request |
| session-consumer permission event order | 单测 | 权限事件顺序正确 |
| approval callback 幂等与失败回滚 | 单测 | 批准后续跑可靠 |
| changedFiles / trace artifact | 回归 | 深化后不破坏 finalization |
| MCP tool discovery | 单测 | MCP server 的工具能被 Claude executor 发现 |
| MCP tool execution | 集成 | MCP 工具在 Claude executor 内执行成功 |
| Skill tool loading | 单测 | Skill 文件正确加载 |
| Memory round-trip | 单测 | memory 写入后能被下次执行读取 |
| Claude-routed 单角色 permission approval e2e | 集成 | 完整权限审批闭环 |

---

## Phase 6：路由与上线策略

### 本阶段引入的特性

| 特性 | 引入层级 | 说明 |
|:-----|:--------|:-----|
| Provider 多模型兼容层 | 深化 | 从"只支持 Claude Code 一个 provider"扩展到可选 OpenAI / Gemini 等 |
| Token 预算 & 成本控制 | 深化 | 多 provider 费率映射、成本告警阈值 |
| Auto Mode | **首次** | 自动权限决策降低 canary 阶段的人工确认频率 |

### Phase 6 测试准备

| 测试项 | 类型 | 说明 |
|:-------|:-----|:-----|
| ai-config claude-code scene / department 解析 | 单测 | 路由配置正确 |
| Prompt Mode canary 路由 | 单测 | canary workspace 路由到 Claude |
| legacy-single coding stage 路由 | 单测 | coding stage 默认走 Claude |
| prestart fallback | 单测 | Claude 不可用时降级到 Native |
| rollback / kill switch | 单测 | 紧急关停生效 |
| 多 provider 费率映射 | 单测 | 成本统计对不同 provider 正确 |
| 一条真实 canary run | 集成 | 端到端跑通一个真实 coding 任务 |

---

## Phase 6 之后：后续迭代

以下特性不在当前 Phase 1-6 范围内，但已经记录在特性总目录中，等 Phase 6 稳定后按需排入。

| 特性 | 说明 | 前置条件 |
|:-----|:-----|:--------|
| Agent/Task 子系统 | 二阶 agent 编排（Coordinator / Worker） | Phase 5 工具系统深化完成 |
| Plan Mode | 结构化规划能力 | Phase 5 工具系统深化完成 |
| Bridge / Remote Control | 远程执行、多会话并发 | Phase 4 intervention 完成 |
| Daemon / 后台会话 | 长驻进程监督 | Phase 2 session 持久化完成 |
| Computer Use | 屏幕截图与键鼠模拟 | Phase 5 MCP + 工具系统完成 |
| Voice Mode | 语音输入 | Phase 1 基座完成 |
| SSH 远程执行 | SSH 连接与远程命令 | Phase 1 基座完成 |
| Server / IDE 直连 | 本地 TCP 服务器 | Phase 1 基座完成 |
| Worktree / 项目隔离 | Git worktree 多项目并行 | Phase 2 session 持久化完成 |

---

## 3. 每个 Phase 的特性数量与代码增量估算

| Phase | 首次引入特性 | 深化特性 | 预计新增代码量 | 预计测试量 |
|:------|:-----------:|:--------:|:-------------:|:---------:|
| Phase 1 | 6 | 0 | ~8000 行 | 6 组测试 |
| Phase 2 | 1 | 1 | ~3000 行 | 4 组测试 |
| Phase 3 | 1 | 1 | ~4000 行 | 6 组测试 |
| Phase 4 | 0 | 1 | ~3000 行 | 6 组测试 |
| Phase 5 | 5 | 3 | ~12000 行 | 9 组测试 |
| Phase 6 | 1 | 2 | ~4000 行 | 7 组测试 |
| **合计** | **14** | **8** | **~34000 行** | **38 组测试** |
| 后续 | 8 | - | ~30000 行 | 待定 |

---

## 4. 关键依赖链条

```
Phase 1 (基座)
  ├─→ Phase 2 (session)
  │     ├─→ Phase 3 (事件归一化)
  │     │     └─→ Phase 5 (tool/permission/artifact)
  │     └─→ Phase 4 (intervention)
  │           ├─→ Phase 5 (tool/permission/artifact)
  │           └─→ Phase 6 (路由上线)
  └─→ Phase 6 (路由上线)
```

硬依赖：
1. Phase 2 → Phase 3/4/5/6
2. Phase 3 → Phase 5
3. Phase 4 → Phase 5/6

---

## 5. 风险矩阵

| Phase | 最大风险 | 缓解方式 |
|:------|:--------|:---------|
| Phase 1 | Claude Code 内部 query loop 与外部 adapter 的接口不稳定 | 先用 one-shot 模式，不做真实 streaming parity |
| Phase 2 | session provenance 字段设计不足，后续被迫频繁扩展 | 一次性预留 canonical 字段集 |
| Phase 3 | 事件归一化丢信息，导致上层页面展示不全 | raw trace 始终保留，归一化只做 summary layer |
| Phase 4 | attach/resume 在 Claude Code 侧不稳定 | 先做 embedded-local profile，不依赖 Claude CLI --resume |
| Phase 5 | permission 审批阻塞 run 且无法恢复 | 暂停-审批-续跑 > 阻塞-审批-重试 |
| Phase 6 | 默认路由切换导致生产事故 | kill switch + canary workspace + prestart-only fallback |

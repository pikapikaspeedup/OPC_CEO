# 后续开发功能清单 (Post Claude Engine Migration)

> 基于 2026-04-10 项目全景分析。M1-M8 ClaudeEngine 迁移 + Agent Pipeline 接入已完成。

---

## Phase A: Provider 配置可用性（让用户能选择和使用 claude-api）

| # | 功能 | 范围 | 预估 |
|:--|:-----|:-----|:-----|
| A1 | **扩展 Provider 选择器** | `department-setup-dialog.tsx` 的 NativeSelect 增加 `claude-api` / `openai-api` / `claude-code` 选项 | 小 |
| A2 | **Agent Run API 增加 provider 参数** | `POST /api/agent-runs` 请求体增加可选 `provider` 字段，覆盖 resolveProvider 默认值 | 小 |
| A3 | **API Key 管理 UI** | 新组件 `ApiKeyManager`：按 provider 输入/保存 API Key，存入 `ai-config.json`，带"测试连接"按钮 | 中 |
| A4 | **Quick Task 增加 Provider 选择** | `quick-task-input.tsx` 增加 provider 下拉，和 model 联动 | 小 |

---

## Phase B: Settings 管理面

| # | 功能 | 范围 | 预估 |
|:--|:-----|:-----|:-----|
| B1 | **Settings 页面框架** | Sidebar 增加 Settings 入口 → 独立面板，Tab 分区（Provider / Model / General） | 中 |
| B2 | **AI Config 可视化编辑器** | 编辑 `ai-config.json`：Layer 级 provider/model、Scene 级 override、Organization 默认值 | 大 |
| B3 | **Model 定价配置** | 各 provider/model 的 token 单价配置表，用于 Usage 计算 | 小 |
| B4 | **Provider 健康检查面板** | 显示已注册 provider 列表、连接状态、最近调用成功率 | 中 |

---

## Phase C: 可观测性 & Usage

| # | 功能 | 范围 | 预估 |
|:--|:-----|:-----|:-----|
| C1 | **Agent Run 详情增强** | AgentRunDetail 显示实际 provider、model、token usage、费用 | 中 |
| C2 | **Token 消耗仪表盘** | 按 provider/model/部门/日期 的 token 消耗图表 | 大 |
| C3 | **实时流式文本展示** | claude-api provider 的 text_delta 实时推送到前端 Chat 组件（SSE/WebSocket） | 大 |
| C4 | **Provider 切换 A/B 对比** | 同一任务分别用不同 provider 执行，对比结果/速度/费用 | 大 |

---

## Phase D: ClaudeEngine 增强

| # | 功能 | 范围 | 预估 |
|:--|:-----|:-----|:-----|
| D1 | **autoCompact 消息压缩** | queryLoop 集成 token 阈值检测 + Haiku 压缩调用 | 大 |
| D2 | **prompt-too-long 恢复** | 收到 413 时触发 reactive compact + 重试 | 中 |
| D3 | **max_output_tokens 恢复** | 升级到 64k + 注入"继续"消息 + 最多 3 次重试 | 中 |
| D4 | **流式工具执行** | StreamingToolExecutor：在 API 流式返回时并行启动工具执行 | 大 |
| D5 | **多 Provider 路由** | fallback model 支持、429/529 时自动切换备用 provider | 大 |

---

## Phase E: 系统补全

| # | 功能 | 范围 | 预估 |
|:--|:-----|:-----|:-----|
| E1 | **知识库向量搜索** | 接入 embedding API + 向量存储，支持语义检索知识条目 | 大 |
| E2 | **审计日志增强** | 完整记录 provider/model/token 使用、权限决策、工具调用链 | 中 |
| E3 | **认证系统**（如需多用户） | OAuth (Google/GitHub) + 会话管理 + 用户隔离 | 超大 |
| E4 | **权限 UI 完整性** | 权限规则可视化编辑器 + 权限测试模拟 | 中 |

---

## 推荐执行顺序

```
A1 → A2 → A3 → A4          (1-2 天，让 claude-api 立即可用)
    ↓
B1 → B2                     (2-3 天，统一配置管理)
    ↓
C1 → C3                     (2-3 天，核心可观测性)
    ↓
D1 → D2 → D3                (2-3 天，ClaudeEngine 健壮性)
    ↓
剩余功能按需迭代
```

---

## 不纳入范围

- ~~MCP 编辑器~~ — 给 Open 用的，Antigravity 不适配
- 多租户隔离 — 当前单用户够用
- 自定义集成市场 — 过大

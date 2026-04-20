# Permission 系统深度研究报告

**日期**: 2026-04-11

## 核心发现

项目中有 **三层** Permission/Approval 系统，但 **都没有完整投入使用**：

| 层 | 模块 | 状态 |
|:---|:-----|:-----|
| 1 | Claude Engine PermissionChecker | 有实例，但执行链不调用它 |
| 2 | CEO Approval 框架 | 能创建/审批，但通知未初始化、回调未实现 |
| 3 | Security Framework | 完整骨架，但零调用方 |

## 默认开箱即用体验

**用户第一次使用时：**
- **所有工具默认全部允许执行**，包括 BashTool
- **没有任何工具前审批**（PermissionChecker 没接进 ToolExecutor）
- **文件操作唯一限制**：路径沙箱（path-sandbox.ts），不允许读写 workspace 外的文件
- **BashTool 没有危险命令拦截**：rm -rf、git reset --hard 等都会直接执行
- **Approval 面板**：能看到卡片，但主要来自 stage failed/blocked/timeout 的运行时事件

## 第 1 层：Claude Engine PermissionChecker

**位置**: `src/lib/claude-engine/permissions/`

**支持的决策类型**: allow / deny / ask

**规则匹配逻辑**（已实现但未使用）:
```
deny 规则 → ask 规则 → bypassPermissions → acceptEdits/plan 模式 → allow 规则 → fallback ask
```

**关键问题**: 
- `claude-engine.ts` 创建了 PermissionChecker 实例
- 但 `query-loop.ts` 和 `tool-executor.ts` **完全不调用它**
- 工具类型有 `checkPermissions`、`validateInput`、`isDestructive` hooks
- 但 ToolExecutor 只做 `isEnabled` 和 `Zod safeParse`，不调用这些 hooks

**结论**: PermissionChecker 是完整的库，但不是执行时拦截器。

## 第 2 层：Approval 框架

**位置**: `src/lib/approval/`

**审批类型**: token_increase / tool_access / provider_change / scope_extension / pipeline_approval / other

**数据流**:
```
submitApprovalRequest → createApprovalRequest → persistRequest → dispatchNotifications
PATCH/feedback → handleApprovalResponse → respondToRequest → persistRequest
```

**存储**: `~/.gemini/antigravity/requests/*.json`

**关键问题**:
- `loadPersistedRequests` 没有任何调用点 → 重启后内存队列丢失
- `initDefaultChannels` 没有任何调用点 → 通知通道未注册
- `generateApprovalToken` 没有调用方 → 签名链接不工作
- 回调执行（update_quota、resume_run、notify_agent）都是 placeholder
- 前端按钮只在 pending 时显示，但后端允许对 feedback 状态再次响应

**触发来源（仅 2 个）**:
1. `approval-triggers.ts`: stage failed/blocked/timeout 事件
2. `group-runtime.ts`: Token 配额（但 recordTokenUsage 无调用方）

## 第 3 层：Security Framework

**位置**: `src/lib/security/`

**已实现**: 默认策略、规则解析、bash safety、sandbox、hooks、组织/部门策略加载

**关键问题**: `resolveSecurityConfig` 和 `checkToolSafety` 只有定义+测试，零调用方。

## 工具权限现状

| 工具 | 元数据 | 实际限制 |
|:-----|:-------|:---------|
| FileReadTool | isReadOnly=true | 路径沙箱 |
| FileWriteTool | isDestructive=true | 路径沙箱 |
| FileEditTool | isDestructive=true | 路径沙箱 + old_string 匹配 |
| BashTool | 超时/输出截断/危险标记 | **无实际拦截** |
| GlobTool | isReadOnly=true | 路径沙箱 |
| GrepTool | isReadOnly=true | 路径沙箱 |

## 如果要修，优先级

### P0: 接通 PermissionChecker
- 在 ToolExecutor 中加入 `checker.check(tool, input)` 调用
- 让 deny → 拒绝执行，ask → 创建 approval request
- 这是最小改动、最大收益

### P1: Approval 闭环
- 初始化通知通道（`initDefaultChannels`）
- 恢复持久化（`loadPersistedRequests`）
- 实现回调执行（resume_run 等）

### P2: Security Framework 接入
- 将 `checkToolSafety` 接入 ToolExecutor 或替代 PermissionChecker

# Self Evolution 专题索引

**日期**: 2026-04-30  
**状态**: 专题入口  
**边界**: 本目录只汇总主软件自迭代机制、架构事实、已验证执行边界和软件用户场景索引；业务上下文、Skill、Workflow 的改进属于业务能力进化，不归入本专题。

## 1. 当前定位

本专题只回答一件事：

> 如何在不新增第二套机制的前提下，复用现有 Department / Project / Company Kernel / Approval / Ops / CEO Office，把主软件自迭代跑成一条真实闭环。

当前主线默认围绕：

1. 内置平台工程部门
2. 主软件用户场景缺口到系统改进 proposal 的链路
3. Codex CLI worktree runner 代码执行链
4. 准入 / 准出双门槛

## 2. 核心文档

### 当前机制

1. [当前软件自迭代机制](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/current-auto-iteration-mechanism-2026-05-01.md>)
2. [软件自迭代产品化缺口](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/software-self-iteration-productization-gap-2026-05-01.md>)
3. [平台工程部 Codex CLI Worktree 执行评估](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/platform-engineering-codex-worktree-execution-assessment-2026-05-01.md>)
4. [内置平台工程部门 Contract](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/builtin-platform-engineering-department-contract-2026-04-30.md>)
5. [Provider Adapter 与 Execution Tool 收口设计](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/provider-adapter-and-execution-tool-remediation-design-2026-04-30.md>)
6. [历史试运行计划](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/trial-run-action-plan-2026-04-30.md>)

### 边界外文档

1. [业务能力进化边界](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/business-capability-evolution/current-business-capability-evolution-boundary-2026-05-01.md>)

### 架构真相源

1. [ARCHITECTURE.md](</Users/darrel/Documents/Antigravity-Mobility-CLI/ARCHITECTURE.md>)
2. [Company Kernel Boundary Audit](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/company-kernel-boundary-audit-2026-04-25.md>)

### 用户场景索引

1. [CEO Office 用户场景索引](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/CEO Office/CEO 办公室.md>)
2. [Projects 用户场景索引](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Projects/项目工作台.md>)
3. [Knowledge 用户场景索引](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Knowledge/知识库.md>)
4. [Ops 用户场景索引](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Ops/运维中心.md>)
5. [Settings / 个人偏好](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/个人偏好.md>)
6. [Settings / Provider 配置](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/Provider 配置.md>)
7. [Settings / Scene 覆盖](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/Scene 覆盖.md>)
8. [Settings / 预算策略](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/预算策略.md>)
9. [Settings / MCP 服务器](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/MCP 服务器.md>)
10. [Settings / 会话平台](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/会话平台.md>)
11. [Settings / 凭证中心](</Users/darrel/Documents/Antigravity-Mobility-CLI/User Story/Settings/凭证中心.md>)

## 3. 推荐阅读顺序

1. 先读 [当前软件自迭代机制](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/current-auto-iteration-mechanism-2026-05-01.md>)，确认当前已接通机制、人工边界、去重和准出规则。
2. 再读 [软件自迭代产品化缺口](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/software-self-iteration-productization-gap-2026-05-01.md>)，确认 approved proposal 到 CEO/Ops 准出视图还缺哪些组件。
3. 再读 [ARCHITECTURE.md](</Users/darrel/Documents/Antigravity-Mobility-CLI/ARCHITECTURE.md>)，确认系统已有机制。
4. 再读 [内置平台工程部门 Contract](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/builtin-platform-engineering-department-contract-2026-04-30.md>)，确认责任主体。
5. 再读 [平台工程部 Codex CLI Worktree 执行评估](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/platform-engineering-codex-worktree-execution-assessment-2026-05-01.md>)，确认 Codex CLI 自开发执行基线。
6. 再读 [Provider Adapter 与 Execution Tool 收口设计](</Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/self-evolution/provider-adapter-and-execution-tool-remediation-design-2026-04-30.md>)，确认执行层收口边界。
7. 最后结合 `User Story` 文档判断系统改进信号来源。

## 4. 当前机制口径

当前不再新增第二套软件自迭代机制。

当前机制遵循：

1. 复用现有 Department / Project / Company Kernel / Approval / Ops / CEO Office。
2. 系统改进从 signal / proposal 进入平台工程部 Project / Run。
3. 代码级修改通过 Codex CLI worktree runner 在隔离 worktree 中执行。
4. 准出依赖 evidence、allowlist、验证命令和 CEO / Ops 可消费证据。
5. merge / push / deploy / restart 不属于当前自动机制。
6. 业务上下文、Skill、Workflow 的自我改进不称为 self-evolution，在业务能力进化专题中描述。

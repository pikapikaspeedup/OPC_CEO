# Claude Engine

`src/lib/claude-engine/` 是 provider-neutral 执行核心。它负责 transcript、tool runtime、权限、安全检查以及与 provider/tool adapter 的衔接。

## 子目录职责

- `api/`
  - provider transport、重试、Pi API 对接
- `engine/`
  - chat / tool execution 主循环
- `tools/`
  - ExecutionTool 等工具侧适配
- `permissions/`
  - 自动模式、工具权限裁决
- `memory/`
  - engine 内部记忆与 transcript 辅助
- `security-core/`
  - upstream-synced security primitives
- `security-adapters/`
  - 本仓库本地适配层；不要把本地逻辑再塞回 `security-core/`

## 当前边界

- provider 选择与组织级配置不在这里做
  - 外层由 `src/lib/backends/*`、`src/lib/providers/*` 决定
- 这里不应该知道 UI / project / company-kernel 细节
- 本地安全适配统一放 `security-adapters/*`

## 新增能力时先看

- 普通 provider chat/tool 行为：`engine/` + `api/`
- 执行工具整合：`tools/` + `permissions/`
- shell / path 安全：`security-adapters/` + `security-core/`

## 当前不要再做的事

- 让本地适配逻辑和 upstream core 继续混目录
- 从 UI / route 层直接把业务状态塞进 engine 内部

# Runtime Logging Boundaries（2026-05-09）

目标：先用一份明确边界文档，避免 `run-history`、`execution-journal`、`ops-audit` 继续记录同一类事件。

## 决议

- `run-history`
  - 只负责 conversation / transport / provider 事实。
  - 适合记录 user message、assistant message、provider dispatch、provider transcript。
- `execution-journal`
  - 只负责 node 粒度的执行控制流。
  - 应保留 `node:activated`、`node:completed`、`node:failed`、`condition:evaluated` 这类事件。
- `ops-audit`
  - 只负责 stage / scheduler / operator 视角的操作审计。
  - gate、switch、loop、checkpoint 应逐步收口到这里。

## 当前状态

- `gate` 已从 `execution-journal` 写入点移除，当前只落 `ops-audit`。
- `execution-journal` 的公开事件类型已缩到 `node:*` 与 `condition:evaluated`。
- `switch / loop / checkpoint` 仍保留在审计边界决议中，但现网没有新的 journal 写入点。

## 短期执行规则

- 新增日志事件时，先问一句：这是 node 控制流，还是 stage/operator 审计？
- 如果是 node 内部生命周期，就落 `execution-journal`。
- 如果是审批、切换、loop、checkpoint、scheduler、操作员动作，就优先落 `ops-audit`。
- `run-history` 不再接纳新的控制流语义事件。

## 后续迁移顺序

1. 保持 `execution-journal` 只服务 node 粒度生命周期。
2. 新增任何 gate / switch / loop / checkpoint 事实时，一律先落 `ops-audit`。
3. 如后续仍无新的 journal 消费方，再评估是否把 `execution-journal` 进一步压缩为纯内部调试资产。

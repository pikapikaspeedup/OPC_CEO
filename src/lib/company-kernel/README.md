# Company Kernel

`src/lib/company-kernel/` 负责公司内核、CEO 视图、agenda、budget、company loop，以及系统自迭代主线。

## 当前活跃主线

- operating signals
  - `operating-signal.ts`
  - `operating-signal-store.ts`
- agenda / budget / circuit breaker
  - `agenda-store.ts`
  - `budget-gate.ts`
  - `budget-ledger-store.ts`
  - `circuit-breaker.ts`
- company loop
  - `company-loop-executor.ts`
  - `company-loop-selector.ts`
  - `company-loop-policy.ts`
  - `company-loop-run-store.ts`
- self-improvement
  - `self-improvement-store.ts`
  - `self-improvement-approval.ts`
  - `self-improvement-codex-execution.ts`
  - `self-improvement-release-gate.ts`
  - `self-improvement-control-state.ts`

## 当前明确边界

- `self-improvement-*` 是唯一新自动化主线
- `growth-*` 是 legacy 兼容层
  - 已不再生成新 growth proposal
  - growth 写接口已退成 `410 Gone`
  - 不要再把新能力接回 `growth-*`

## 先看哪里

- CEO 决策列表：`ceo-decision-control.ts`
- company loop：`company-loop-executor.ts`
- 系统改进 proposal 状态：`self-improvement-control-state.ts`
- 执行与 release gate：`self-improvement-codex-execution.ts` / `self-improvement-release-gate.ts`
- 预算/阻断：`budget-gate.ts` / `circuit-breaker.ts`

## 当前需要避免

- 新增第二条 proposal/evaluate/approval/execution 平行主线
- 把 legacy growth 数据重新当成活跃治理入口
- 在 company-kernel 外层重复定义 company loop / proposal 状态机

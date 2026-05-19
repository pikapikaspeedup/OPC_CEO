# Observability & Resilience RFC（2026-05-10）

> **状态**：调研结论 + 推荐方案。等用户决策后入"第 1 档"执行 / 或下放"第 3 档"暂缓。
> **关联**：[Architecture Review T3-2](./architecture-review-2026-05-09.md#第-2-档调研中待-rfc-决策)
>
> **核心要回答**：
> > "出过几次跨进程故障定位超过 30 分钟的事？花的代价值不值得引入 OpenTelemetry 这种重型依赖？"
>
> **结论先行**：当前 correlationId 覆盖 ~60%（缺 grpc / scheduler / bridge worker 子进程透传）；circuit-breaker 仅 1 处接入，proxy / gRPC / LLM 都没接。**推荐两阶段方案**：先做 **A+B 混合**（circuit-breaker 接入 proxy/grpc/LLM + 补 correlationId 透传，2-4 周）；中期看痛点再决定是否进 **B 完整版（自研轻量 trace）**。**不推荐 C / D**。

---

## 一、现状摸底（事实基础）

### 1. T3-1 correlationId 真实覆盖度

| 维度 | 现状 |
|------|------|
| 注入点 | `src/lib/request-context.ts` AsyncLocalStorage（60 行）+ `http-server.ts` 入口 middleware + `logger.ts` 自动绑定 ✅ |
| Web → Control-Plane / Runtime 跨进程 | `src/server/shared/proxy.ts:proxyRequestToBase()` 显式传 `x-ag-correlation-id` header ✅ |
| Control-Plane → Runtime 二级转发 | 同 proxy 机制 ✅ |
| Runtime → Bridge Worker 子进程 | ❌ **无透传**——`bridge-worker-process.ts` 只传 `AG_PROCESS_ROLE: 'bridge-worker'` 环境变量；stdio 'inherit' 但无 correlationId 继承 |
| Runtime → Language Server (gRPC) | ❌ **无透传**——`grpc.ts` 的 `streamAgentState()` / `grpcCall()` 不带 correlationId |
| Scheduler 自主触发的任务 | ❌ **无 context 包裹**——`scheduler.ts` 自主跑的 job 每次新 UUID，无父链路关联 |
| CEO autonomous loop 内部产物 | ❌ **同上**——`company-loop-executor.ts:createRun()` 调用时不传 correlationId |

**覆盖估算**：约 **60%**——HTTP 调用栈完整，但子进程 + gRPC + 自主触发 3 处断链。

### 2. circuit-breaker 实际接入度

`src/lib/company-kernel/circuit-breaker.ts`（355 行，4 状态机）当前接入：

| 接入点 | 行为 |
|--------|------|
| `src/lib/agents/run-registry.ts` | run 终止时 `recordRunTerminalForCircuitBreakers(run)` 按 status 记录 ✅ |
| `src/lib/company-kernel/budget-gate.ts` | `canExecuteOperation()` 查 `isCircuitOpen()` 决定是否阻止 ✅ |
| `src/app/api/company/circuit-breakers/route.ts` | 列表 + 重置 API ✅ |

**未接入的关键路径**：

| 路径 | 接入价值 |
|------|---------|
| `src/server/shared/proxy.ts:proxyRequestToBase()` | 🔴 高 — control-plane 故障时 web 不级联 |
| `src/lib/bridge/grpc.ts:streamAgentState() / grpcCall()` | 🔴 高 — language server 故障不让 runtime 卡死 |
| `@mariozechner/pi-ai` LLM API 调用层 | 🟡 中 — provider 故障不级联（但 pi-ai 本身有重试）|

**预估接入工作量**：proxy ~40 LOC、grpc ~60 LOC、LLM ~50 LOC = **~150 LOC + 测试**

### 3. 故障定位现状

**当前可用工具**：
- 3 个日志文件（system / conversation / workspace），都自动带 correlationId（在 60% 覆盖范围内）
- circuit-breaker 状态 API（事后查谁挂了）
- Management metrics（聚合指标，无链路）

**没有的工具**：
- ❌ Prometheus / metrics endpoint
- ❌ OpenTelemetry collector
- ❌ Distributed trace UI（Jaeger / Honeycomb / Datadog）
- ❌ 实时性能 dashboard

**实际排障痛点**：
- Web → Control-Plane → Runtime ✅ correlationId 串得起来
- Runtime → Bridge Worker → Language Server ❌ **完全断链**——出故障只能猜
- Scheduler 自主跑的事 ❌ **每次新 UUID**，无法跟 trigger 关联

---

## 二、痛点验证

| 痛点 | 当前发生概率 | 影响 |
|------|------------|------|
| Web → Control-Plane → Runtime 路径 trace | 已串好 | ✅ 排障 30 分钟内 |
| Runtime → Bridge Worker / gRPC trace | ❌ 完全黑盒 | 🔴 单次故障定位 1-2 小时 |
| Scheduler 自主任务 trace | ❌ 完全黑盒 | 🟡 偶发，但很难复盘 |
| Provider API 故障级联 | 🟡 中（pi-ai 自带部分保护，但 proxy 层没 circuit）| 上游慢导致下游全部超时 |
| 上游故障级联打挂下游 | 🔴 高（无 circuit-breaker 在 proxy / gRPC） | 单点故障扩散 |

**核心判断**：**T3-1 已经覆盖了高频故障定位（HTTP 调用栈）；剩下的盲点是中低频但定位成本极高的"子进程 + gRPC"边界**。

---

## 三、四方案对比

| 维度 | 方案 A（仅 circuit-breaker）| 方案 B（自研轻量 trace）| 方案 C（OTel + 自托管 Jaeger）| 方案 D（OTel + SaaS）|
|------|---------------------------|------------------------|----------------------------|---------------------|
| **解决什么** | 防故障级联 | 跨进程 trace 可见 | 标准化 + 可视化 | 标准化 + 可视化 + SaaS UI |
| **不解决什么** | 排障仍是黑盒 | 无 dashboard、自研工具 | 单点工具复杂 | 数据出仓 / 月费 |
| **新增 LOC** | ~150 | ~350（A 全包 + correlationId 补齐 + span tree + audit-trail API）| 1200+（包含 OTel 配置 + Jaeger 部署）| 1200+ |
| **外部依赖** | 无 | 无 | `@opentelemetry/sdk-node` + `@opentelemetry/exporter-jaeger`（~400KB）| 同 C + SaaS account |
| **运维复杂度** | 低 | 低 | 🔴 高（要管 Jaeger + Cassandra/ES）| 🟡 中（API key 管理） |
| **数据合规** | ✅ 不出仓 | ✅ 不出仓 | ✅ 不出仓 | ❌ 数据上传第三方（GDPR/SOC2 风险）|
| **月成本** | $0 | $0 | $0（自托管基础设施成本另算）| $40-200/月（Honeycomb 起步）|
| **学习曲线** | 极低 | 低 | 🔴 陡（OTel SDK + Jaeger 配置 + 采样率）| 🟡 中 |
| **耗时** | 1-2 周 | 3-4 周 | 6-8 周（含 Jaeger 部署） | 3-4 周 |
| **适合规模** | 任何 | < 5 人团队 / 内部工具 | > 10 人 / 产品级 | 有 SaaS 预算 |

---

## 四、推荐：两阶段方案

### Phase 1：A+B 预备（2-4 周，强烈推荐立刻做）

**目标**：把"防故障级联"和"trace 透传补齐"一次做完。

| 子任务 | 内容 | 工作量 |
|--------|------|--------|
| circuit-breaker 接入 proxy | `proxyRequestToBase()` try/catch 包 → 失败时 `recordCircuitFailure()` + 后续短路 | ~40 LOC + 测试 |
| circuit-breaker 接入 gRPC | `grpc.ts` 的 streamAgentState / grpcCall 包 circuit | ~60 LOC + 测试 |
| circuit-breaker 接入 LLM | `pi-transport.ts` 加薄壳 | ~50 LOC + 测试 |
| correlationId 透传到 gRPC | `grpc.ts` 的请求 metadata 加 correlation-id | ~20 LOC |
| correlationId 透传到子进程 | `bridge-worker-process.ts` spawn 时传环境变量；子进程读取后 `runWithRequestContext()` 包裹 | ~10 LOC |
| correlationId 透传到 scheduler 自主任务 | `scheduler.ts` 自主触发时生成新 correlationId 但记 `parentCorrelationId` | ~30 LOC |

**总投入**：约 **210 LOC + 单测**，2-4 周。

**Phase 1 完成后效果**：
- correlationId 覆盖 60% → **95%**
- 防故障级联：3 个关键路径（proxy / gRPC / LLM）都有保护
- **不引入任何外部依赖**

### Phase 2：B 完整版（中期，按痛点决定）

**触发条件**（满足任一才做）：
- Phase 1 完成 6 周后，仍然出现 ≥ 2 次"跨进程故障定位 > 30 分钟"
- 团队扩到 ≥ 5 人，需要标准化排障工具
- CEO autonomous loop 跑得多到需要 trace tree 可视化

**做的内容**：
- 在日志层增加 `spanId` / `parentSpanId`，按 correlationId 关联
- 新增 `GET /api/traces/:correlationId` 聚合 API
- 新增 `<CorrelationTree>` 内部 debug UI

**总投入**：~140 LOC（Phase 1 之上的增量）+ 1-2 周。

### 不推荐 C / D

**为什么不推荐 C（OTel + Jaeger）**：
- 当前流量 / 团队规模不足以正当化 Jaeger 运维复杂度
- Jaeger 依赖 Cassandra / ES，**运维成本远超工具收益**
- 学习曲线陡，团队需要单独投入

**为什么不推荐 D（OTel + SaaS）**：
- 用户日志 / trace 上传第三方有 **GDPR / SOC2 合规风险**
- 月费 $40-200 对内部工具来说 ROI 不正
- 离线 / 受限环境无法排障

**未来如果真要切 OTel**：建议先做完 Phase 1+2，等团队真的觉得"自研工具撑不住"再切——届时迁移成本可控（OTel 标准就是要支持自定义 span，Phase 2 的结构兼容）。

---

## 五、决策选项

请用户选：

- **A**. 同意做 Phase 1（A+B 预备），加入第 1 档执行（~3-4 周投入）
- **B**. 同意做 Phase 1，但只做"circuit-breaker 接入 3 个路径"，不补 correlationId 透传（~1-2 周）
- **C**. Phase 1 + Phase 2 一起做（5-6 周）
- **D**. 全部转入第 3 档暂缓，等出过 ≥ 2 次"30 分钟以上"故障再启动
- **E**. 其他想法

---

## 六、关键决策点

| 维度 | 当前数据 | 决策方向 |
|------|---------|---------|
| **故障频度阈值** | 月度跨进程故障定位 > 2 次且 > 30 分钟 → Phase 2 ROI 为正 | 现在不知道实际频度，需要先观察 1-2 个月 |
| **团队规模** | 当前 1-2 人 | < 5 人优先 Phase 1（最少投入解决高 ROI 问题）；> 10 人才考虑 OTel |
| **合规要求** | 内部使用，无外发要求 | 排除 SaaS（D 方案） |
| **运维能力** | 团队没有 Jaeger 运维经验 | 排除自托管（C 方案） |

---

## 七、风险与缓解

| 风险 | 缓解 |
|------|------|
| circuit-breaker 触发率过高 | 默认 threshold=3，coolDown=30 分钟；监控 + tune |
| 子进程 correlationId 透传引入复杂度 | 只通过 env var，不引入 IPC 协议改动 |
| Phase 2 后期切 OTel 工程量被低估 | 在 Phase 2 设计 span 结构时**兼容 OTel format**（即使不用 OTel SDK） |

---

> 维护：本 RFC 是 2026-05-10 调研快照。如方案推进，进度写到 `docs/PROJECT_PROGRESS.md` 并反向引用本文 T3-2。

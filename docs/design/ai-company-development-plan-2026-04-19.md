# AI 公司系统开发计划

**日期**: 2026-04-19  
**目的**: 为后续 8-12 周的研发提供清晰节奏、阶段边界、交付要求与冻结规则，避免需求扩散、实现顺序混乱和架构反复返工。

---

## 1. 计划目标

本计划解决的不是“最终愿景是什么”，而是：

> **接下来按什么顺序做，做到什么程度算完成，每周怎么推进，哪些事情现在不能碰。**

本计划默认基于以下已确认判断：

1. `DAG` 是 `Execution Plane` 的核心子系统，但不是整个 AI 公司系统。
2. 当前首要短板不是执行编排，而是：
   - knowledge loop
   - memory loop
   - evolution loop
   - management loop
3. 后续系统应逐步形成：
   - `Organization Plane`
   - `Communication Plane`
   - `Management Plane`
   - `Learning Plane`
   - `Execution Plane`

---

## 2. 开发总原则

## 2.1 一条主线原则

任何阶段只允许有一条主线目标，不同时推动多个大主题。

当前建议主线顺序：

1. `Knowledge Loop v1`
2. `CEO Actor v1`
3. `Management Console v1`
4. `Execution Profiles` 正式分层
5. `Evolution Pipeline v1`

### 解释

如果一开始同时推：

- 记忆
- CEO 数字分身
- 管理看板
- 自主演进
- 多 Provider 扩展

最后只会得到：

- 接口很多
- 页面很多
- 规则很多
- 但没有任何一条闭环真正可用

## 2.2 闭环优先原则

每个阶段必须优先形成最小闭环，而不是只堆半成品能力。

例如：

- `Knowledge Loop v1` 要求至少形成：
  - run → memory extraction
  - memory storage
  - retrieval 注入下次执行

如果只有：

- run 完成后写几段 Markdown

不能算阶段完成。

## 2.3 先地基、后外观原则

优先级固定为：

1. 数据合同
2. runtime 闭环
3. 管理接口
4. UI 呈现

不允许先做炫 UI，再补底层合同。

## 2.4 可追溯原则

每个阶段都必须满足：

- 有明确设计文档
- 有测试证据
- 有真实链路验证
- 有 `PROJECT_PROGRESS` 更新

---

## 3. 范围与边界

## 3.1 本阶段 In Scope

本开发计划覆盖以下工作流主线：

1. 知识沉淀与知识管理
2. CEO actor 化与用户同步进化基础设施
3. 经营控制台 / OKR / KPI / 风险可视化
4. 执行模型分层（workflow-run / review-flow / dag-orchestration）
5. workflow / skill 自演化闭环

## 3.2 本阶段 Out of Scope

下列事项本轮明确不作为主线：

1. 大规模新增 Provider 适配
2. 多机分布式协同完整实现
3. 无审批的全自动自我进化
4. 大规模 UI 视觉重做
5. 非关键外部 SaaS 集成

---

## 4. 总体阶段规划

## 4.1 阶段总览

| 阶段 | 时间建议 | 目标 | 核心交付 |
|:--|:--|:--|:--|
| Phase 0 | 3-5 天 | 收口合同与主链路 | 数据对象、阶段边界、验收标准 |
| Phase 1 | 2 周 | `Knowledge Loop v1` | 结构化沉淀 + retrieval 回流 |
| Phase 2 | 2 周 | `CEO Actor v1` | CEO state / event / routine 基座 |
| Phase 3 | 2 周 | `Management Console v1` | CEO 总览 + Department 经营页 + Knowledge Console |
| Phase 4 | 1-2 周 | `Execution Profiles` 分层 | 三档执行模型明确化 |
| Phase 5 | 2-3 周 | `Evolution Pipeline v1` | workflow/skill proposal → evaluate → publish |

总周期建议：

- **基础版本**：8 周
- **稳妥版本**：10-12 周

---

## 5. Phase 0：合同与主链路冻结

## 5.1 目标

在正式开发前，先冻结：

1. 关键系统对象
2. 每阶段成功标准
3. 一条最小主链路

## 5.2 关键交付

必须冻结以下对象合同：

1. `CEOProfile`
2. `DepartmentContract`
3. `ExecutionProfile`
4. `KnowledgeAsset`
5. `ManagementMetric`

必须确定以下最小主链路：

1. CEO 发起一个任务
2. Department 接收并运行
3. run 完成产出 artifact / result
4. run 结果沉淀为知识
5. 下一次执行能用上这段知识

## 5.3 出口标准

满足以下条件才能进入 Phase 1：

1. 设计稿冻结
2. 主链路定义冻结
3. `Definition of Done` 冻结
4. 不再继续争论大方向

---

## 6. Phase 1：Knowledge Loop v1

## 6.1 目标

把“有记忆文件”升级为“最小可用知识闭环”。

## 6.2 本阶段解决的问题

当前问题：

- 有局部沉淀
- 有局部注入
- 没有真正闭环

本阶段结束后应达到：

1. run 完成后稳定提取结构化知识
2. 知识进入统一 store
3. 下次执行可按需召回
4. 管理层可查看新增知识

## 6.3 核心交付

1. `Memory Extractor v1`
   - 从 result / artifact / summary 中提取：
     - decisions
     - patterns
     - lessons
     - reusable context

2. `Knowledge Store v1`
   - 至少支持：
     - category
     - source
     - timestamp
     - confidence
     - scope

3. `Retrieval Layer v1`
   - 执行前按 Department / task intent 检索相关 knowledge

4. `Knowledge Console v0`
   - 先有最小查看页，不要求完整大屏

## 6.4 不做的事

本阶段不做：

1. 自动改写 workflow
2. 自动改写 skill
3. 复杂知识图谱
4. 高级搜索体验

## 6.5 出口标准

1. 至少一条真实 run 链路完成后能生成结构化知识条目
2. 至少一条后续 run 能使用检索出的知识上下文
3. CEO/Department 页面能看到最近新增知识
4. 有测试覆盖 extractor / retrieval / storage 核心逻辑

---

## 7. Phase 2：CEO Actor v1

## 7.1 目标

把 CEO 从 command parser 升级为最小可用 actor。

## 7.2 本阶段解决的问题

当前 CEO 主要是：

- request-driven
- command-driven

本阶段结束后至少要具备：

1. 持久状态
2. 事件消费
3. routine thinking
4. 用户反馈接入

## 7.3 核心交付

1. `CEO State Store`
   - active focus
   - recent decisions
   - preferences
   - pending issues

2. `CEO Event Consumer`
   - 消费：
     - project events
     - approval events
     - scheduler events
     - knowledge events

3. `CEO Routine Loop`
   - 每日/每周 routine 生成：
     - digest
     - reminders
     - escalation list

4. `User Feedback Ingestion`
   - 能记录用户对 CEO 决策的修正

## 7.4 不做的事

本阶段不做：

1. 完整人格化包装
2. 高复杂外部世界接入（日历/邮件全量）
3. 过度智能的自主派发

## 7.5 出口标准

1. CEO 状态不是纯会话内临时变量
2. CEO 能消费组织事件并生成结构化待办/提醒
3. CEO 能形成每日/每周 digest
4. 用户的反馈能进入 CEO 状态或记忆

---

## 8. Phase 3：Management Console v1

## 8.1 目标

从 execution observability 升级到 management observability。

## 8.2 核心交付

1. `CEO Overview`
   - 目标进度
   - 高优异常
   - 待审批 / 待决策
   - 建议动作

2. `Department Dashboard`
   - throughput
   - blockage
   - resource usage
   - workflow hit-rate
   - recent knowledge

3. `Knowledge Console v1`
   - recent additions
   - high reuse
   - conflict / stale items

4. `Metrics Contract v1`
   - 明确 management metrics 计算口径

## 8.3 本阶段不做

1. 全量 BI 系统
2. 复杂自定义图表系统
3. 过度美化的经营大屏

## 8.4 出口标准

1. 用户能从 CEO 总览看到真正的经营状态，而不只是 run 列表
2. Department 页面至少有 3-5 个经营指标可用
3. Knowledge Console 能帮助用户发现复用与沉淀机会

---

## 9. Phase 4：Execution Profiles 分层

## 9.1 目标

正式把执行模型分成三档，避免继续“DAG 吞掉一切”。

## 9.2 核心交付

1. `ExecutionProfile` 合同正式生效
2. dispatch policy 能判断：
   - `workflow-run`
   - `review-flow`
   - `dag-orchestration`
3. UI 和 scheduler 都基于 profile 说话

## 9.3 出口标准

1. 成熟 routine 不再默认走重 DAG
2. 方案评审类任务可稳定走 review-flow
3. 真正复杂任务仍走 DAG

---

## 10. Phase 5：Evolution Pipeline v1

## 10.1 目标

把“发现重复模式”升级为“受控自演化闭环”。

## 10.2 核心交付

1. `Proposal Generator`
   - 从 knowledge / repeated executions 生成 workflow/skill proposal

2. `Replay Evaluator`
   - 用历史任务或样本验证 proposal

3. `Approval Publish Flow`
   - proposal 必须经过 CEO/治理层批准

4. `Rollout Observe`
   - 发布后观察命中率与效果

## 10.3 本阶段不做

1. 无审批自动发布
2. 自动覆盖线上核心 workflow
3. 全自动自改规则系统

## 10.4 出口标准

1. 至少一条 workflow proposal 能完整走完：
   - 发现
   - 评估
   - 审批
   - 发布
   - 观察

---

## 11. 周节奏设计

## 11.1 建议周节奏

### 周一：计划与冻结

产出：

1. 本周唯一主线
2. 本周明确不做事项
3. 本周成功标准

### 周二到周四：实现主线

要求：

1. 只围绕本周主线推进
2. 发现新想法先记 backlog，不中途切主线
3. 以最小闭环为目标，不做扩张型开发

### 周五：验证与复盘

产出：

1. 真实链路验证
2. 测试证据
3. 文档更新
4. backlog 调整

---

## 11.2 每周固定输出

每周结束至少产出：

1. 一个明确可演示的闭环
2. 一份短复盘
3. 一次 `PROJECT_PROGRESS` 更新
4. 一份 backlog 调整说明

---

## 12. 开发冻结规则

## 12.1 冻结规则

以下情况必须冻结，不允许继续扩功能：

1. 主链路没跑通
2. 核心数据合同还在频繁变
3. 验证标准不明确
4. 当前阶段还没有可演示闭环

## 12.2 禁止事项

当前阶段禁止：

1. 同时启动两个大 workstream
2. 为了“看起来完整”提前做大 UI
3. 在治理闭环没成立前做无审批自治
4. 在 Knowledge Loop 没成立前做大规模 CEO 进化包装

---

## 13. 验收门槛

## 13.1 Definition of Ready

一个阶段开始前必须满足：

1. 目标清晰
2. 边界清晰
3. 输入输出清晰
4. 成功标准清晰

## 13.2 Definition of Done

一个阶段完成必须满足：

1. 有真实链路验证
2. 有自动化测试或最小 smoke
3. 有文档收口
4. 有 `PROJECT_PROGRESS` 更新
5. 有明确下一阶段入口条件

---

## 14. 风险清单

### 风险 A：节奏失控

表现：

- 一周改三个方向
- 无法形成闭环

控制方式：

- 强制一周一主线

### 风险 B：架构空转

表现：

- 文档很多
- 主链路没跑通

控制方式：

- 每阶段必须有可验证闭环

### 风险 C：产品空心化

表现：

- 页面很多
- 没有真实经营数据

控制方式：

- UI 必须后于合同和 runtime

### 风险 D：自治失控

表现：

- 自主演进直接改资产
- 没有审批与回滚

控制方式：

- proposal → evaluate → approve → publish 固定化

---

## 15. 当前建议的立即动作

接下来建议按这个顺序执行：

1. 冻结本开发计划
2. 进入 `Phase 0`
3. 把 `Phase 1 Knowledge Loop v1` 拆成文件级任务清单

### 当前建议优先级

1. `Knowledge Loop v1`
2. `CEO Actor v1`
3. `Management Console v1`

### 暂不建议优先的事项

1. 大规模 Provider 扩展
2. 多机协同
3. 全自动自我进化
4. 重 UI 包装

---

## 16. 最终判断

为了确保节奏不乱，当前最重要的不是“写更多功能”，而是：

> **把开发主线收紧成阶段闭环，并且每周只服务一个目标。**

一句话执行口径：

> **先做 Knowledge Loop，再做 CEO Actor，再做 Management Console；一阶段一闭环，一周一主线。**


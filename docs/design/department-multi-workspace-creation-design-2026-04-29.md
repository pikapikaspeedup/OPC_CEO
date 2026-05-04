# 部门新建与多 Workspace 绑定设计

**日期**: 2026-04-29  
**状态**: 设计方案  
**边界**: 本文是设计文档，不代表功能已完成，不写入 `docs/PROJECT_PROGRESS.md`。

## 1. 问题定义

当前系统把 Department 实际建模成“一个 workspace 上的 `.department/config.json`”，这会带来三个根问题：

1. 没有真正的“新建部门”实体逻辑，只有“导入 workspace 后配置部门”。
2. 一个部门只能天然对应一个 `workspaceUri`，无法表达“一个部门跨多个目录协作”。
3. CEO 路由、预算、知识、审批、指标、定时任务都把 `workspaceUri` 当作部门 ID，导致部门和执行目录耦合。

这和目标心智不一致。

目标心智应该是：

1. Department 是组织对象。
2. Workspace 是执行对象。
3. 一个部门可以绑定一个主目录，也可以绑定多个目录。
4. 每次任务在“合适的 workspace”里运行。
5. 其余目录和上下文文档作为附加可读上下文，而不是都变成当前任务的写入根。

## 2. 目标模型

### 2.1 概念拆分

后续需要明确区分四个对象：

1. `Department`
   - 组织单元。
   - 负责名字、类型、技能、Provider、预算、OKR、记忆策略、默认执行策略。
2. `WorkspaceBinding`
   - 部门和目录之间的绑定关系。
   - 一个部门可以有多个 binding。
3. `ExecutionWorkspace`
   - 某一次任务真正的主执行目录。
   - 一次 run 只能有一个主写入根。
4. `ContextAttachment`
   - 任务运行时附带的额外上下文目录或上下文文档。
   - 这些目录通常只读，必要时才能进入可写集。

### 2.2 设计原则

1. “部门”不能再由 `workspaceUri` 反推出来。
2. “任务在哪个 workspace 运行”必须是显式决策，不允许继续默认“部门 = 当前 workspace”。
3. 多目录部门不是多主目录并发写入；默认仍应是一主多辅。
4. 上下文文档是 Department 资产，不应该只能藏在某个单一 workspace 下。
5. 兼容旧数据时，单目录部门必须零迁移可用。

## 3. 当前代码卡点

### 3.1 DepartmentConfig 仍然是 workspace-scoped

`src/lib/types.ts` 的 `DepartmentConfig` 只有名称、类型、技能、OKR、provider、quota 等字段，没有：

1. `departmentId`
2. 多 workspace bindings
3. 默认执行 workspace 策略
4. 上下文文档资产

### 3.2 Department API 仍以 workspace 为主键

`/api/departments` 当前是：

1. `GET /api/departments?workspace=<uri>`
2. `PUT /api/departments?workspace=<uri>`

落盘位置仍是：

```text
<workspace>/.department/config.json
```

这意味着：

1. 新建部门必须先有 workspace。
2. 一个部门无法自然绑定多个 workspace。
3. Department 的真实身份仍由目录决定。

### 3.3 CEO 路由仍把部门当作 workspace

`src/lib/agents/ceo-agent.ts` 当前通过：

```ts
Map<string, DepartmentConfig>
```

派生 DepartmentEntry，其中 key 直接是 `workspaceUri`。后续创建 project、预算预占、prompt/template dispatch 都直接使用这个 `workspaceUri`。

### 3.4 管理指标和知识也都按单 workspace 聚合

当前下列能力都默认“部门 = workspace”：

1. `src/lib/management/metrics.ts`
2. `src/lib/knowledge/*`
3. `src/lib/approval/*`
4. `src/lib/agents/scheduler.ts`
5. `src/lib/company-kernel/*` 中大量 `workspaceUri` 归因

### 3.5 运行时其实已经有多目录底座

`DepartmentRuntimeContract` 已有：

1. `workspaceRoot`
2. `additionalWorkingDirectories`
3. `readRoots`
4. `writeRoots`

这说明“一个任务主跑在 A 目录，同时读取 B/C 目录”的运行模型已经存在，只是 Department 配置层和路由层还没接上。

## 4. 目标数据模型

### 4.1 新的一等实体：DepartmentRecord

建议新增组织级 Department 存储，不再只依赖 `workspace/.department/config.json`。

建议对象：

```ts
interface DepartmentRecord {
  departmentId: string;
  name: string;
  type: string;
  typeIcon?: string;
  description?: string;
  provider?: ProviderId;
  skills: DepartmentSkill[];
  okr?: DepartmentOKR | null;
  roster?: DepartmentRoster[];
  tokenQuota?: TokenQuota | null;
  templateIds?: string[];
  workspaceBindings: DepartmentWorkspaceBinding[];
  executionPolicy: DepartmentExecutionPolicy;
  contextAssets?: DepartmentContextAsset[];
  createdAt: string;
  updatedAt: string;
  migratedFromWorkspaceUri?: string;
}
```

### 4.2 WorkspaceBinding

```ts
interface DepartmentWorkspaceBinding {
  bindingId: string;
  workspaceUri: string;
  alias?: string;
  role: 'primary' | 'execution' | 'context' | 'artifact';
  enabled: boolean;
  writeAccess: boolean;
  pathHints?: string[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
  priority?: number;
}
```

语义：

1. `primary`
   - 默认主目录。
   - 新建项目、默认调度、默认知识归属优先落这里。
2. `execution`
   - 可被任务直接选为主执行目录。
3. `context`
   - 默认只作为附加读取目录。
4. `artifact`
   - 承载交付产物或参考材料，不默认写业务代码。

### 4.3 ExecutionPolicy

```ts
interface DepartmentExecutionPolicy {
  defaultWorkspaceBindingId?: string;
  workspaceSelectionMode: 'manual' | 'rule-based' | 'primary-first';
  allowCrossWorkspaceContext: boolean;
  maxWritableBindings: number;
  defaultContextBindingIds?: string[];
}
```

默认规则建议：

1. 初版使用 `primary-first`。
2. 默认一次任务只允许 1 个可写 binding。
3. 其余 binding 进入 `additionalWorkingDirectories` 和 `readRoots`。

### 4.4 ContextAsset

```ts
interface DepartmentContextAsset {
  assetId: string;
  title: string;
  kind: 'doc' | 'folder-note' | 'playbook' | 'knowledge';
  bindingId?: string;
  path?: string;
  contentRef?: string;
  requiredForRouting?: boolean;
}
```

目的：

1. 显式表达“潜在上下文档”。
2. 不再要求上下文只能依附某一个 workspace 根目录。
3. 后续可直接拼进 prompt/runtime contract。

## 5. 新建部门主流程

### 5.1 单目录部门

最小闭环：

1. 点击“新建部门”。
2. 输入部门名称、类型、描述。
3. 选择一个本地目录作为主 workspace。
4. 系统注册 workspace catalog。
5. 创建 DepartmentRecord。
6. 创建第一个 binding：
   - `role=primary`
   - `writeAccess=true`
7. 如用户愿意，再补 provider、skills、OKR、context docs。

### 5.2 多目录部门

最小闭环：

1. 点击“新建部门”。
2. 先创建 DepartmentRecord，不要求先绑定目录。
3. 添加一个或多个 workspace bindings。
4. 明确指定：
   - 哪个是默认主执行目录
   - 哪些是上下文目录
   - 哪些目录允许写
5. 保存后生成部门。

### 5.3 UI 语义

按钮不应再叫“导入 workspace”来代表“新建部门”。

建议拆成两步：

1. `新建部门`
   - 创建组织对象。
2. `添加目录`
   - 给部门绑定 workspace。

否则产品心智会继续被带回“workspace 先于 department”。

## 6. 任务运行时如何选 workspace

### 6.1 运行决策输出

当前 CEO / Scheduler / Prompt dispatch 在创建 run 前，需要先得到：

```ts
interface DepartmentWorkspaceResolution {
  departmentId: string;
  primaryWorkspaceUri: string;
  primaryWorkspacePath: string;
  additionalWorkingDirectories: string[];
  readRoots: string[];
  writeRoots: string[];
  selectedBy: 'manual' | 'default-primary' | 'rule';
  selectedBindingId: string;
  contextBindingIds: string[];
}
```

### 6.2 初版规则

为了避免一开始过度智能化，建议初版只支持三条规则：

1. 如果用户显式指定 binding 或 workspace，则按指定执行。
2. 如果命中某个路径别名或部门 skill 规则，则选择对应 execution binding。
3. 否则回退到 `defaultWorkspaceBindingId`，没有就用 `primary`。

### 6.3 运行时合同映射

分辨完成后，把结果落到已有 `DepartmentRuntimeContract`：

1. `workspaceRoot = primaryWorkspacePath`
2. `additionalWorkingDirectories = 其他 context/execution bindings`
3. `readRoots = workspaceRoot + additional dirs + context doc roots`
4. `writeRoots = 默认仅主 workspace + artifactRoot`

这意味着：

1. 不需要推翻现有 Claude Engine / runtime contract。
2. 重点是把“选哪个主目录”提前成显式步骤。

## 7. API 补充建议

### 7.1 新增 Department 一等 API

建议新增：

1. `GET /api/organization/departments`
2. `POST /api/organization/departments`
3. `GET /api/organization/departments/:id`
4. `PUT /api/organization/departments/:id`
5. `POST /api/organization/departments/:id/bindings`
6. `PUT /api/organization/departments/:id/bindings/:bindingId`
7. `DELETE /api/organization/departments/:id/bindings/:bindingId`
8. `POST /api/organization/departments/:id/resolve-workspace`

### 7.2 旧 API 保持兼容

旧的 `/api/departments?workspace=` 不应立刻删除。

建议兼容策略：

1. 若某 workspace 只映射到一个 department，则继续返回该 Department 的兼容配置。
2. 若某 workspace 属于多个 department，则旧接口返回 409，提示前端切换到新的 department API。
3. `workspace/.department/config.json` 逐步退化为本地 shadow cache，而不是唯一真相源。

## 8. 存储与迁移建议

### 8.1 组织级 Department Store

建议新增组织级存储，例如：

```text
~/.gemini/antigravity/departments/<departmentId>.json
```

或进入 SQLite 主库，但第一阶段建议：

1. SQLite 记录索引
2. JSON 存完整文档

这样迁移和调试成本更低。

### 8.2 旧数据迁移

对于现有单目录部门：

1. 扫描 `listKnownWorkspaces()`
2. 发现 `workspace/.department/config.json`
3. 为每个旧配置生成一个 DepartmentRecord
4. 自动创建一个 `primary` binding
5. 保留 `migratedFromWorkspaceUri`

迁移后：

1. 页面默认从新 Department Store 读取
2. 旧接口从新 Store 投影兼容值

## 9. 对现有模块的改动面

### 9.1 前端

至少涉及：

1. `src/components/ceo-dashboard.tsx`
2. `src/components/department-setup-dialog.tsx`
3. `src/app/page.tsx`
4. `src/components/projects-panel.tsx`

核心变化：

1. 不再把 workspace 列表直接当部门列表。
2. 新建部门对话框先创建 Department，再绑定目录。
3. Department 详情页要展示 bindings 和默认执行目录。

### 9.2 路由与类型

至少涉及：

1. `src/lib/types.ts`
2. `src/lib/api.ts`
3. `src/server/control-plane/routes/departments.ts`
4. 新增 `src/server/control-plane/routes/organization-departments.ts`

### 9.3 CEO 路由与调度

至少涉及：

1. `src/lib/agents/ceo-agent.ts`
2. `src/lib/agents/scheduler.ts`
3. `src/lib/management/metrics.ts`
4. `src/lib/company-kernel/*`

核心变化：

1. 预算、调度、digest、knowledge、risk 归因要支持 `departmentId`。
2. `workspaceUri` 退化为“执行发生在哪个目录”的运行属性，而不是部门主键。

## 10. 分阶段落地建议

### Phase 1：部门一等实体化

目标：

1. 新增 DepartmentRecord store
2. 新增新建部门 API
3. 支持“单目录部门”闭环
4. 旧数据自动迁移

这一步先不做复杂路由规则。

### Phase 2：多目录绑定

目标：

1. 一个部门可绑定多个 workspace
2. 可设置 primary / execution / context
3. UI 可编辑 binding

### Phase 3：运行前 workspace resolution

目标：

1. CEO command / scheduler / project dispatch 改成先 resolve workspace
2. 把 resolution 写入 run metadata
3. DepartmentRuntimeContract 使用 resolved roots

### Phase 4：归因体系从 workspace 切到 departmentId

目标：

1. management overview
2. budget gate
3. knowledge binding
4. scheduler
5. company kernel

都逐步补齐 `departmentId` 和 `workspaceUri` 双字段。

## 11. 明确不建议的做法

1. 不建议继续把“新建部门”实现成 `importWorkspace + 改名` 的 UI 包装。
2. 不建议让一个 run 默认同时对多个业务目录可写。
3. 不建议第一阶段就做复杂自动路由或 LLM 决策选目录。
4. 不建议让上下文文档继续隐式散落在各 workspace 中而没有显式资产层。

## 12. 建议结论

最稳的补法不是继续增强“导入 workspace”，而是做三件事：

1. **把 Department 提升为一等实体**
2. **把 Workspace 改成 Department 的 binding**
3. **把任务执行前的 workspace 选择变成显式解析步骤**

这样既能支持：

1. 单目录部门
2. 多目录部门
3. 任务在合适 workspace 运行
4. 潜在上下文档附带进入运行时

又能最大化复用当前已经存在的 `DepartmentRuntimeContract` 多目录能力，而不需要推翻整个执行层。

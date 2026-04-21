# 部门设置与 Antigravity 强耦合审计

日期：2026-04-20

## 1. 结论摘要

当前“部门设置”之所以显得强依赖 Antigravity，不是因为部门模型本身必须依赖某个 IDE，而是因为系统把下面三个本来不同的概念错误地合并成了同一个东西：

1. **系统知道这个工作区存在**  
2. **Antigravity 当前正在运行这个工作区**  
3. **这个工作区允许拥有 Department 配置**

现在的实现里，这三者几乎都通过 `getWorkspaces()` 和前端 `running workspace` 过滤链路绑定到一起，所以导致了几个直接后果：

1. **部门设置入口依赖 Antigravity 运行态**：主页只给“正在运行的 workspace + CEO workspace”展示部门卡片与设置入口，未运行的项目很难进入部门设置流程。
2. **部门相关 API 依赖 Antigravity 工作区目录**：`config / sync / memory / digest / quota` 等接口都复用了 `isRegisteredWorkspace()`，而这个注册来源不是 OPC 自己的目录，而是 Antigravity 的最近打开工作区列表。
3. **保存配置会立刻触发 IDE 镜像同步**：`PUT /api/departments` 在写入 `.department/config.json` 后，会直接 `syncRulesToAllIDEs()`，把配置保存和多 IDE 派生文件同步绑成一个动作。
4. **工作区发现和部门管理的边界被打穿**：`/api/workspaces` 在返回工作区列表时还会顺手 `discoverLanguageServers()` 并 `ensureCEOWorkspaceOpen()`，进一步把“浏览部门/工作区”变成了“触发 Antigravity 运行态”。

真正的根因不是“缺少一个兼容层”，而是：

> **Department 作为领域对象已经存在，但 Workspace Catalog、Runtime Presence、IDE Mirror 三层没有拆开。**

因此，合理的整体方案不是继续在各路由里补白名单判断，也不是简单删除 `isRegisteredWorkspace()`；而是要把部门系统改造成：

1. `.department/config.json` 继续作为部门配置源数据
2. 增加 **独立于 Antigravity 的 Workspace Catalog**
3. 把 **Runtime Presence** 变成一个状态维度，而不是身份维度
4. 把 **Department Sync** 变成派生适配层，而不是保存配置时的强副作用
5. 保留 Antigravity 作为一个 IDE/Runtime Adapter，从而不影响原生 Antigravity IDE 正常运行

## 2. 本次审计范围

本次只评估“部门设置为何强依赖 Antigravity，以及怎样在不破坏原生 Antigravity IDE 的前提下解耦”，重点核对了以下链路：

1. 工作区发现与目录来源
2. 部门设置前端入口
3. `api/departments*` 相关接口
4. DepartmentConfig / DepartmentContract / DepartmentRuntimeContract 的现状
5. Department Sync 到多 IDE 的适配方式
6. 与 CEO / 运营指标相关的隐式耦合点

## 3. 现状梳理

### 3.1 Department 的真正源数据其实已经是本地文件

从领域建模上看，部门配置的真实源数据已经不是 Antigravity 内部状态，而是工作区内的：

```text
<workspace>/.department/config.json
```

证据：

1. `src/lib/agents/department-capability-registry.ts:320-337`
   `readDepartmentConfig(workspacePath)` 直接从 `.department/config.json` 读取配置，不依赖 Antigravity 运行态。
2. `src/lib/agents/department-capability-registry.ts:501-587`
   代码已经可以把 `DepartmentConfig` 进一步构造成：
   - `DepartmentContract`
   - `DepartmentRuntimeContract`
3. `src/lib/organization/contracts.ts:49-107`
   `DepartmentContract` 和 `DepartmentRuntimeContract` 已经是独立的运行时治理对象。

这说明：

> **从领域模型上，Department 已经具备“脱离 Antigravity 存在”的基础。**

问题不在 Department 模型本身，而在入口和控制面。

### 3.2 Workspace Catalog 目前不是 OPC 自己管理，而是借用了 Antigravity 的最近打开列表

`src/lib/bridge/statedb.ts:154-164`：

```ts
export function getWorkspaces(): Array<{ type: 'folder' | 'workspace'; uri: string }> {
  const raw = queryDb("SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList';");
  ...
}
```

这意味着当前 OPC 的“工作区目录”来自：

1. Antigravity / VS Code 全局状态库 `state.vscdb`
2. key 为 `history.recentlyOpenedPathsList`

所以系统现在默认认为：

1. 出现在 Antigravity 最近打开列表里的工作区，才是系统认可的工作区
2. 不在这个列表里的本地项目，即使你明确知道路径，也不算“合法部门”

这本质上是把 **OPC 的 Workspace Catalog** 外包给了 **Antigravity IDE 的历史记录**。

### 3.3 前端入口进一步把部门设置缩窄成“正在运行的 Antigravity 工作区”

`src/app/page.tsx:217-232` 会加载：

1. `api.servers()`
2. `api.workspaces()`

随后 `src/app/page.tsx:677-679`：

```ts
const agentWorkspaces = buildWorkspaceOptions(agentServers, agentWorkspacesRaw, hiddenWorkspaces)
  .filter(workspace => (workspace.running || workspace.uri.includes('ceo-workspace')) && !workspace.hidden)
```

然后 `src/app/page.tsx:686-700` 又只对 `agentWorkspaces` 拉取 `api.getDepartment(ws.uri)`。

这带来一个关键事实：

> **在当前产品入口里，部门设置不是“面向所有项目”，而是“面向已经跑起来的 Antigravity 工作区”。**

也就是说，即使某个目录已经在 `recentlyOpenedPathsList` 里，只要它当前没跑 language server，也不会出现在主视图部门卡片中。

### 3.4 “添加部门”实际上是在启动 Antigravity

`src/components/ceo-dashboard.tsx:396-406` 的“+ 添加部门”按钮会先 `prompt()` 路径，然后调用 `api.launchWorkspace()`。

`src/app/api/workspaces/launch/route.ts:12-31` 又会直接执行：

```ts
spawnSync(ANTIGRAVITY_CLI, ['--new-window', wsPath], ...)
```

也就是说，现在产品语义并不是：

1. 导入一个项目到 OPC
2. 为它创建 Department 配置

而是：

1. 先在 Antigravity 中打开一个工作区
2. 等待它成为运行中的 workspace
3. 再在 OPC 里把它当作部门

这就是入口层的产品架构耦合。

### 3.5 `/api/workspaces` 本身还会顺手启动 CEO Workspace

`src/app/api/workspaces/route.ts:7-16`：

1. 返回 `getWorkspaces()`
2. 先 `discoverLanguageServers()`
3. 再 `ensureCEOWorkspaceOpen(runningWs)`

而 `src/lib/agents/ceo-environment.ts:459-494` 里，`ensureCEOWorkspaceOpen()` 会在必要时调用 Antigravity CLI 自动加入 CEO workspace。

这说明：

> **就连“列工作区”这个只读动作，也带着 Antigravity 运行态副作用。**

对于部门设置来说，这会让“看配置”和“触发运行时”混在一起。

### 3.6 Department 相关 API 普遍把“已在 Antigravity 注册”当作权限边界

以下接口都复用了 `getWorkspaces()` + `isRegisteredWorkspace()`：

1. `src/app/api/departments/route.ts:15-18, 23-25, 48-50`
2. `src/app/api/departments/sync/route.ts:13-24`
3. `src/app/api/departments/memory/route.ts:19-22, 36-49`
4. `src/app/api/departments/digest/route.ts:9-12, 40-41`
5. `src/app/api/departments/quota/route.ts:17-21`

结果是：

1. 配置读写依赖 Antigravity workspace 注册
2. Department Memory 依赖 Antigravity workspace 注册
3. Digest / Quota 这种纯读聚合接口也依赖 Antigravity workspace 注册
4. Sync 到其它 IDE 的动作也依赖 Antigravity workspace 注册

这不是单点 bug，而是控制面整体把 Department 和 Antigravity catalog 绑在了一起。

### 3.7 保存 DepartmentConfig 会强制同步到所有 IDE 镜像

`src/app/api/departments/route.ts:54-58`：

```ts
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
syncRulesToAllIDEs(uri);
```

而 `src/lib/agents/department-sync.ts:36-54, 171-220` 说明：

1. `antigravity` 会写入 `workspace/.agents/rules` 和 `workspace/.agents/workflows`
2. `codex` 会写入 `workspace/AGENTS.md`
3. `claude-code` 会写入 `workspace/CLAUDE.md`
4. `cursor` 会写入 `workspace/.cursorrules`

这段代码本身不是问题。问题在于：

> **Department Sync 本来应该是“由 canonical department assets 派生到各 IDE 的适配层”，现在却被硬塞进了“保存配置”的事务里。**

于是“我只是想改部门名称/OKR/技能”会自动变成“重写各 IDE 说明文件”。

### 3.8 运营指标层也在借用 Antigravity 工作区目录

`src/lib/management/metrics.ts` 中，组织 OKR 进度会用 `getWorkspaces()` 枚举工作区，再逐个读取部门配置。

这意味着即使未来你允许某个项目拥有 `.department/config.json`，只要它不在 Antigravity 最近打开列表中，它在组织级指标里也可能“不可见”。

所以问题并不只在 UI 和 API，而是已经延伸到管理视图。

## 4. 根因分解

### 4.1 真正的架构错误：三个层次没有拆开

当前系统实际上把下面三层混在了一起：

1. **Workspace Catalog**
   OPC 自己知道哪些工作区存在、显示名是什么、是否隐藏、是否已导入。
2. **Runtime Presence**
   哪些工作区当前在 Antigravity / Claude Code / 其它 runtime 中活着。
3. **Department Domain**
   哪些工作区拥有 `.department/config.json`，以及对应的 DepartmentContract / RuntimeContract。

当前代码里的默认关系更接近：

```text
Antigravity 最近打开列表 = 系统认可工作区
系统认可工作区 = 可以有部门配置
运行中的工作区 = 前端主要部门入口
保存部门配置 = 立即同步到所有 IDE
```

这四个等号就是根因。

### 4.2 安全边界也建模错了

现在 `isRegisteredWorkspace()` 的设计初衷是防路径穿越，这个方向没有错；错的是把安全边界建立在“Antigravity 最近打开过这个路径”上。

更合理的安全边界应该是：

1. 这个路径是否被 OPC 自己的 Workspace Catalog 显式收录
2. 是否经过 `realpath` / 规范化路径校验
3. 是否处于允许管理的根目录范围内，或已被用户明确导入

否则就会出现一种奇怪的逻辑：

1. 路径安全，但没被 Antigravity 打开过 -> 拒绝
2. 路径未必是当前业务要管理的对象，但在 Antigravity 历史里 -> 放行

这不是好的控制面边界。

### 4.3 保存语义和派生语义混在了一起

`DepartmentConfig` 是主数据。  
`AGENTS.md / CLAUDE.md / .cursorrules / .agents/rules` 是派生物。

当前实现把两者做成同步事务，结果就是：

1. 派生文件写失败会污染“设置保存”的用户心智
2. 同步所有 IDE 会引入额外 IO 和意外覆盖
3. 无法表达“只更新配置，不立即下发到所有 IDE”
4. 无法表达“这个项目根本不需要 Antigravity mirror，只需要 Codex/Claude”

这不是技术 bug，而是控制面职责划分错误。

### 4.4 URI / Path 口径也存在漂移

当前不同层对 workspace 身份的处理并不统一：

1. 有的地方保留 `file://`
2. 有的地方会 `replace(/^file:\/\//, '')`
3. `DepartmentContract.workspaceUri` 又会重新 `toWorkspaceUri(...)`

这不是当前最核心的问题，但它加剧了耦合，因为每层都在自行解释“什么叫同一个 workspace”。

## 5. 现状与目标之间的差距

| 维度 | 当前状态 | 目标状态 |
| --- | --- | --- |
| Workspace 身份 | 来源于 Antigravity 最近打开记录 | 来源于 OPC 自己的 Workspace Catalog |
| Department 配置合法性 | 由 `isRegisteredWorkspace()` 判定 | 由 `WorkspaceCatalog + canonical path policy` 判定 |
| 前端入口 | 主要面向运行中的 workspace | 面向所有已导入/已配置 workspace，运行态仅作 badge |
| 保存语义 | 写 config 后立即 sync 所有 IDE | 保存配置与 IDE sync 分离 |
| Antigravity 角色 | 目录来源 + 运行态 + IDE mirror 三位一体 | 只是 Runtime / IDE Adapter 之一 |
| 管理指标枚举 | 借用 Antigravity 工作区目录 | 基于 Catalog 枚举 Department |
| 安全边界 | Antigravity 历史记录 | OPC 显式导入、规范化路径、允许根目录 |

## 6. 不影响原生 Antigravity IDE 的兼容约束

本次解耦必须遵守以下兼容原则，否则会误伤原生 Antigravity IDE：

### 6.1 不修改 Antigravity 自己的内部状态模型

不要去改：

1. Antigravity 的 `state.vscdb` 结构
2. language server 发现逻辑本身
3. 原生 `.agents/*` 目录消费语义

OPC 只能把这些内容当作：

1. 可读取的输入源
2. 可选的运行态信号
3. 可选的镜像输出目标

### 6.2 `.department/config.json` 继续是可移植的源数据

Department 的主数据应该继续留在 workspace 内部，这样有三个好处：

1. 项目可移植
2. 不依赖 Antigravity 安装状态
3. 不把业务配置锁死在 OPC 本地数据库里

### 6.3 Antigravity mirror 继续保留，但降级为派生层

`src/lib/agents/department-sync.ts` 已经天然支持多 IDE target。  
这意味着我们不需要删 Antigravity 适配，只需要改变它的职责定位：

1. 保留 `antigravity` target
2. 保留 `.agents/rules` / `.agents/workflows` 生成能力
3. 但不要再让“保存部门设置”默认强制写所有 target

### 6.4 Runtime Presence 不应再决定 Department 是否存在

一个部门可以：

1. 已存在但当前未在 Antigravity 中运行
2. 已配置但从未打开过 Antigravity
3. 只在 Codex / Claude Code 路径中使用

这不会影响原生 Antigravity IDE，因为它只是让 OPC 不再把 Antigravity 当唯一真相源。

## 7. 合理的整体方案

## 7.1 先定义清楚三层对象

### A. WorkspaceCatalogRecord

建议新增控制面对象，存入 OPC 自己的存储层（优先复用 `src/lib/storage/gateway-db.ts` 对应 SQLite，而不是塞回 Antigravity）。

建议字段：

```ts
type WorkspaceCatalogRecord = {
  workspaceUri: string;
  workspacePath: string;
  displayName: string;
  source: 'manual-import' | 'antigravity-recent' | 'ceo-bootstrap' | 'scan';
  status: 'active' | 'hidden' | 'archived';
  configured: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenInAntigravityAt?: string;
};
```

它回答的问题是：

1. 这个 workspace 是否属于 OPC 管理范围
2. UI 应不应该显示它
3. 安全校验时能不能对它读写 `.department`

### B. DepartmentConfig

继续使用：

```text
<workspace>/.department/config.json
```

它回答的问题是：

1. 部门名称、类型、描述、OKR、skills、templateIds、provider、quota

它不应该承担的问题：

1. 当前有没有 Antigravity 语言服务
2. 当前要不要自动打开 Antigravity
3. 本机上次同步到了哪个 IDE target

### C. Runtime Presence

由运行态探测回答，例如：

1. `discoverLanguageServers()`
2. 未来的 Claude Code / Codex runtime 状态

它回答的问题是：

1. 这个 workspace 现在是否运行中
2. 运行在哪个 runtime family
3. 是否在线、可调度

**它只是状态，不是身份。**

## 7.2 把 `Department Sync` 改成显式派生流程

当前 `department-sync.ts` 的目标层设计其实是对的，它已经把不同 IDE 做成 adapter：

1. `antigravity`
2. `codex`
3. `claude-code`
4. `cursor`

真正要改的是触发方式：

### 当前错误语义

```text
保存 DepartmentConfig = 同步所有 IDE
```

### 建议语义

```text
保存 DepartmentConfig = 只更新源数据
Sync Department = 显式动作 / 异步任务 / 可选自动化
```

更合理的方案：

1. `PUT /api/departments` 只负责校验并写入 `.department/config.json`
2. `POST /api/departments/sync` 继续保留，但改成真正的独立动作
3. 可选增加 `department_sync_state`，记录每个 target 的：
   - `lastSyncedAt`
   - `lastStatus`
   - `lastError`
   - `dirtySince`

这样才能做到：

1. 不影响原生 Antigravity IDE
2. 不在每次保存时强写 `AGENTS.md`
3. 让“配置”和“分发”各自失败、各自重试

## 7.3 用独立 Workspace Catalog 替代 `getWorkspaces()` 作为 Department 权限边界

建议把 Department 相关接口统一改成：

1. `resolveWorkspaceFromCatalog(workspaceUri)`
2. `assertWorkspaceManageable(workspacePath)`
3. `read/write .department/*`

而不是：

1. `getWorkspaces()`
2. `isRegisteredWorkspace()`

为了兼容现有系统，可以分两步做：

### 过渡期

Workspace Catalog 初始导入来源包括：

1. 当前 Antigravity `recentlyOpenedPathsList`
2. CEO workspace bootstrap
3. 用户手动导入路径

### 稳定期

Department API 只认 Workspace Catalog，不再直接认 Antigravity 历史记录。

这样既不会一下子把旧工作区全部丢掉，也能逐步摆脱对 Antigravity 的身份依赖。

## 7.4 前端入口要从“运行中的工作区”改成“已导入的部门工作区”

建议把前端展示拆成两层：

1. **Department List**
   来自 Workspace Catalog，展示所有已导入或已配置的部门
2. **Runtime Badge**
   来自 Antigravity / 其它 runtime 探测，显示：
   - running
   - idle
   - offline

这会带来两个直接收益：

1. 你可以先配置部门，再决定是否启动 Antigravity
2. 部门设置不再天然是“运行态附属页”

同时，“+ 添加部门”的语义应改成：

1. 导入项目路径到 Workspace Catalog
2. 可选创建初始 `.department/config.json`
3. 可选再点击“在 Antigravity 中打开”

而不是一上来就 `launchWorkspace()`。

## 7.5 组织级指标也要改为基于 Catalog 枚举

像 `management/metrics.ts` 这类组织视图，应该用：

1. `listCatalogedWorkspaces()`
2. 对每个 workspace 读取 `.department/config.json`

而不是继续走 `getWorkspaces()`。

否则控制面和管理面会继续使用 Antigravity 历史记录作为组织边界，最终“部门设置”即使解耦了，经营视图仍然是错的。

## 8. 推荐分阶段落地

## Phase 1：引入 Workspace Catalog 抽象，不改用户语义

目标：

1. 新增 `workspace catalog` 读写层
2. 首次启动时从 `getWorkspaces()` 导入历史记录
3. 现有 UI 仍可继续工作

验收标准：

1. 不改动 Antigravity 原生行为
2. 目录来源从“直接读取 state.vscdb”变成“Catalog + importer”

## Phase 2：Department API 改为基于 Catalog 校验

范围：

1. `api/departments`
2. `api/departments/sync`
3. `api/departments/memory`
4. `api/departments/digest`
5. `api/departments/quota`

目标：

1. 不再复用 `isRegisteredWorkspace()`
2. 统一用 `workspaceUri <-> workspacePath` 规范化
3. 安全边界改为 `catalog membership + realpath validation`

## Phase 3：拆开保存配置与 IDE 同步

目标：

1. `PUT /api/departments` 只保存
2. 同步动作通过单独按钮、后台 job 或显式 API 触发
3. 增加 sync state 展示

这是用户体感最明显的一步。

## Phase 4：前端部门入口改造

目标：

1. Department Grid 基于 Workspace Catalog
2. Runtime 状态作为 badge
3. “+ 添加部门”改成“导入项目”
4. “在 Antigravity 打开”成为独立动作

## Phase 5：运营与管理视图切换到 Catalog

目标：

1. 管理总览、OKR、Digest、Quota 全部不再依赖 Antigravity 历史记录
2. Antigravity 仅保留为 runtime signal 与可选镜像目标

## 9. 明确不建议的伪修复

以下做法不建议采用：

### 9.1 只删除 `isRegisteredWorkspace()`

这会放开任意路径写入风险，但没有建立真正的 Workspace Catalog，也没有解决 UI、metrics、save-side-effect 问题。

### 9.2 继续保留“保存即同步全部 IDE”，只是把 Antigravity 判断放宽

这会把耦合从“只对 Antigravity 开放”变成“对所有项目都强制重写 IDE 文件”，问题只会扩大。

### 9.3 只改前端入口，不改 API 边界

这样用户能看到更多项目，但保存时依然会被后端 `403 Unknown workspace` 卡住，属于表面解耦。

## 10. 最终建议

综合来看，最合理的整体方向是：

1. **保留 DepartmentConfig 文件制源数据**
2. **新增 OPC 自己的 Workspace Catalog**
3. **把 Runtime Presence 从身份层降为状态层**
4. **把 Department Sync 从保存副作用降为显式派生层**
5. **把 Antigravity 从“系统唯一真相源”降为“兼容性最强的一个 runtime / IDE adapter”**

这样做的结果是：

1. 不破坏原生 Antigravity IDE
2. 保住 `.agents/*` 兼容路径
3. 允许部门先存在、后运行
4. 允许不同 IDE target 按需同步
5. 让 Department 真正成为 OPC 的领域对象，而不是 Antigravity 工作区的附属配置页

---

## 附：本次审计引用的关键证据文件

1. `src/lib/bridge/statedb.ts`
2. `src/app/api/workspaces/route.ts`
3. `src/lib/agents/ceo-environment.ts`
4. `src/app/page.tsx`
5. `src/components/ceo-dashboard.tsx`
6. `src/app/api/workspaces/launch/route.ts`
7. `src/app/api/departments/route.ts`
8. `src/app/api/departments/sync/route.ts`
9. `src/app/api/departments/memory/route.ts`
10. `src/app/api/departments/digest/route.ts`
11. `src/app/api/departments/quota/route.ts`
12. `src/lib/agents/department-sync.ts`
13. `src/lib/agents/department-capability-registry.ts`
14. `src/lib/organization/contracts.ts`
15. `src/lib/management/metrics.ts`

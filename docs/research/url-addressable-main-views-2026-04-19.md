# 主视图 URL 显式化改造（2026-04-19）

## 背景

当前 Gateway 前端虽然有：

- `CEO Office`
- `OPC`
- `Conversations`
- `Knowledge`
- `Settings`

这些主视图，但实际导航状态几乎全部只保存在 React 本地 state 中，导致：

1. 地址栏长期停留在 `/`
2. 刷新后无法稳定恢复当前上下文
3. 无法直接分享某个 CEO / conversation / project 视图
4. 浏览器前进后退几乎没有语义

这会让用户明显感知到“系统里有很多房间，但 URL 没有成为一等公民”。

## 现状问题定位

`src/app/page.tsx` 在改造前主要问题有：

1. `sidebarSection`
2. `activeId`
3. `selectedProjectId`
4. `selectedKnowledgeId`
5. `utilityPanel`

全部只通过 `useState` 管理，没有统一：

- 初始化 URL 解析
- 状态变更后的 URL 写回
- `popstate` 回退同步

因此 CEO / OPC / conversation 视图虽然能切换，但没有稳定可见的浏览器路由表达。

## 设计决策

本次没有把单页应用直接拆成多个 Next route segment，而是先做一层轻量、稳定、低风险的 query-state 路由。

原因：

1. 当前整个 shell 仍然是单页工作台结构
2. 直接拆文件路由会影响范围过大
3. 用户当前最核心诉求是“显式 URL + 可回退 + 可分享”
4. query-state 足够满足这轮 UX 改善，且更容易与现有状态机兼容

## URL 约定

新增统一状态模型：

- `section`
- `panel`
- `tab`
- `focus`
- `conversation`
- `conversationTitle`
- `project`
- `knowledge`

典型 URL：

```text
/?section=projects
/?section=projects&project=<projectId>
/?section=projects&panel=settings&tab=provider&project=<projectId>
/?section=ceo&conversation=<conversationId>&conversationTitle=CEO+Office
/?section=conversations&conversation=<conversationId>&conversationTitle=<title>
/?section=knowledge&knowledge=<knowledgeId>
```

## 实现方案

### 1. 抽出纯函数 URL 状态层

新增：

- `src/lib/app-url-state.ts`
- `src/lib/app-url-state.test.ts`

职责：

1. 解析 URL -> 页面状态
2. 生成 canonical URL
3. 丢弃与当前 `section` 无关的参数

### 2. 在 `page.tsx` 接入双向同步

加入：

1. 首次加载解析 `window.location.search`
2. 状态变化后 `pushState / replaceState`
3. `popstate` 回放

同时把 conversation 选择拆成单独同步逻辑，避免只在 CEO 里工作、而普通 conversation 失效。

### 3. 处理 CEO / 通用 conversation 的差异

增加 `activeConversationScope`，区分：

- `ceo`
- `conversations`

这样可以避免：

1. 从 OPC 切到 CEO 时，把旧普通 conversation 错误写到 CEO URL
2. 从 CEO 切回普通 conversations 时，把 CEO 线程误当通用线程

## 验证结果

### 自动化验证

通过：

```bash
npx eslint src/app/page.tsx src/lib/app-url-state.ts src/lib/app-url-state.test.ts
npm test -- src/lib/app-url-state.test.ts
```

结果：

- ESLint 无错误
- `4 tests passed`

### 真实页面验证

使用 `bb-browser` 对本地运行中的页面做验证：

1. 打开首页后地址栏会规范化为：
   - `/?section=projects`
2. 点击 `CEO Office` 后地址栏变为：
   - `/?section=ceo&conversation=...&conversationTitle=CEO+Office`
3. 点击 `OPC` 后地址栏回到：
   - `/?section=projects`
4. 打开某个项目后地址栏变为：
   - `/?section=projects&project=<projectId>`
5. 打开 `Settings` 后地址栏变为：
   - `/?section=projects&panel=settings&tab=provider&project=<projectId>`
6. 打开 `Conversations` 后地址栏变为：
   - `/?section=conversations`
7. 选中具体 conversation 后地址栏变为：
   - `/?section=conversations&conversation=...&conversationTitle=...`
8. 连续执行 `history.back()`，URL 能正确回退到上一个视图状态

## 结论

这轮改造后，CEO / OPC / Conversations / Settings 已具备明确 URL 语义，用户现在可以：

1. 刷新后保留当前主视图上下文
2. 复制浏览器地址直接分享当前入口
3. 使用浏览器前进后退切换最近访问状态
4. 明确知道自己正处于哪个“房间”

这比“只有 UI 状态、没有 URL 语义”的单页工作台体验明显更完整。

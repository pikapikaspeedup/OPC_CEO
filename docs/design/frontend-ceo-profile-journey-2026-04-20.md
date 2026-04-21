# 前端 CEO Profile 用户旅程补齐设计

日期：2026-04-20

## 1. 当前用户旅程

当前代码里，用户如果想配置“CEO 的工作方式”，实际会走到两条彼此割裂的路径：

1. 进入 `Settings`
2. 只能看到 `provider / api-keys / scenes / mcp / messaging`
3. 看不到 `/api/ceo/profile` 对应的结构化配置入口

另一条路径是：

1. 进入 `CEO Office`
2. 看到 `配置` tab
3. 实际只能编辑 `Persona` 和 `Playbook` 两份 prompt 文档
4. 用户会自然误判这就是“用户配置”

结果是：

1. 后端已经存在 `ceo-profile.json`、`/api/ceo/profile`、`/api/ceo/profile/feedback`
2. 前端没有真正消费这条链路
3. 用户旅程在“发现入口”和“确认生效”两个位置同时断裂

## 2. 主要断点

### 2.1 入口断点

`Settings` 没有 `Profile` tab，用户无法从主配置中心发现结构化 CEO 偏好。

### 2.2 认知断点

`CEO Office > 配置` 实际是 prompt 资产编辑器，不是结构化偏好配置，但 UI 文案没有区分这两层。

### 2.3 深链断点

URL 状态不支持 `tab=profile`，所以无法稳定深链到正确配置入口。

### 2.4 回写断点

`/api/ceo/profile` 和 `/api/ceo/profile/feedback` 已存在，但前端没有“加载 -> 编辑 -> 保存 -> 回显”的闭环。

### 2.5 反馈沉淀断点

用户对 CEO 行为的纠偏只能散落在聊天历史里，没有结构化录入入口。

## 3. 补齐原则

本轮补齐遵循两个约束：

1. 不影响原生 Antigravity IDE 正常运行
2. 不把结构化偏好继续塞回 prompt 文档

因此本轮只补 UI 和现有 API 的接线，不改：

1. Language Server 发现逻辑
2. Antigravity provider 选择逻辑
3. `startCascade / send / cancel` 等原有执行链

## 4. 本轮补齐方案

### 4.1 在 Settings 中新增 `Profile` tab

目标：

1. 把结构化 CEO 偏好放回主设置中心
2. 接入 `/api/ceo/profile`
3. 提供保存反馈和状态回显

覆盖字段：

1. `identity.name`
2. `identity.tone`
3. `priorities`
4. `activeFocus`
5. `communicationStyle.verbosity`
6. `communicationStyle.escalationStyle`
7. `riskTolerance`
8. `reviewPreference`

### 4.2 增加反馈信号录入

目标：

1. 接入 `/api/ceo/profile/feedback`
2. 让“纠偏/偏好/批准/否决”进入结构化存储
3. 在设置页内直接回显最近反馈

### 4.3 修正 CEO Office 的文案与跳转

目标：

1. 把原 `配置` tab 明确改成 `Prompt 资产`
2. 在该页显式提示：这里不是结构化用户配置
3. 提供一键跳转到 `Settings > Profile`

### 4.4 补齐 URL 深链

目标：

1. 允许 `tab=profile`
2. 让页面状态与设置入口保持一致

## 5. 补齐后的目标旅程

### 旅程 A：从设置中心进入

1. 用户打开 `Settings`
2. 看到 `Profile` tab
3. 加载当前 CEO 结构化偏好
4. 编辑并保存
5. 立即看到保存结果和更新时间

### 旅程 B：从 CEO Office 进入

1. 用户进入 `CEO Office`
2. 在 `Prompt 资产` 页看到提示
3. 明确知道 Persona/Playbook 与结构化偏好不是一回事
4. 一键跳转到 `Settings > Profile`
5. 完成结构化配置

### 旅程 C：记录长期反馈

1. 用户在 `Profile` 页选择反馈类型
2. 输入偏好或纠偏内容
3. 写入 `feedbackSignals`
4. 最近反馈立即可见

## 6. 风险与兼容性判断

本轮变更属于：

1. 前端入口补齐
2. 既有 API 消费
3. 文案语义澄清

不会改变：

1. Antigravity IDE 的 workspace / language server 发现链
2. Antigravity provider 运行链
3. 原生 IDE 自己的本地存储格式

因此兼容性风险低，主要风险集中在：

1. 新增 tab 的前端类型联动
2. `CEO Office` 到 `Settings` 的跳转接线
3. 浏览器端表单回显是否正确

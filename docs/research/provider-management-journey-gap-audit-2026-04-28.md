# Provider 管理用户故事审计

日期：2026-04-28  
范围：`Settings -> Provider 配置`、`AI 接入`、`默认配置`、`凭证中心`、相关后端持久化与可用性探测

---

## 1. 文档目标

这份文档不再从工程实现出发，而是从产品经理常用的 `User Stories` 出发，回答 3 件事：

1. 当前 Provider 管理页，用户到底有哪些核心场景
2. 每个用户故事需要满足什么需求
3. 当前实现缺了哪些点，优先级是什么

---

## 2. 核心用户角色

### 角色 A：AI 系统管理员

负责：

1. 接入新的模型服务
2. 配置默认 Provider 和默认模型
3. 维护 API Key、登录态和兼容端点
4. 移除不再使用的接入

### 角色 B：业务使用者 / 管理者

负责：

1. 选择系统默认使用哪个 Provider
2. 理解当前哪些 Provider 可用
3. 发现某个 Provider 不可用时知道下一步怎么办

### 角色 C：技术管理员

负责：

1. 管理 Native / CLI 登录态
2. 处理 Codex / Claude Code / Custom Endpoint 接入异常
3. 配置 layer 覆盖与图像能力

---

## 3. 用户故事总览

当前 Provider 管理的完整旅程，至少应覆盖 10 个用户故事：

1. 查看系统当前已接入的 Provider
2. 添加新的 API Provider
3. 添加新的 Custom / Compatible Provider
4. 识别并使用已经可用的 Native Provider
5. 选择默认 Provider 和默认模型
6. 编辑一个已存在的接入
7. 删除一个已存在的接入
8. 验证一个已保存接入是否仍然可用
9. 管理 Native Provider 的断开/恢复
10. 清理高级配置，回到继承默认

下面逐条展开。

---

## 4. User Stories

### US-01 查看当前已接入的 Provider

**用户故事**  
作为系统管理员，我希望在进入 `Provider 配置` 时，能一眼看到当前系统已经接入了哪些 Provider，这样我才能判断接下来是继续使用、编辑，还是新增接入。

**用户需求**

1. 页面要有明确的“已接入 Provider 集合”
2. 这个集合必须覆盖：
   - API Provider
   - Native Provider
   - Custom Provider
3. “已接入”必须和“当前可实际使用”保持一致
4. 用户能从这里进入下一步动作：
   - 设为默认
   - 编辑
   - 删除/断开

**当前支持**

1. 页面有 `AI 接入`
2. 页面会显示 `已接入 N 个`
3. 页面会显示一条摘要，如 `已接入：OpenAI API`

**缺失点**

1. `native-codex / codex / claude-code / antigravity` 不进入“已接入”集合
2. 结果是页面会出现：
   - 已接入显示 `OpenAI API`
   - 默认 Provider 却是 `native-codex`
3. 用户看到的是两套真相：
   - 一套叫“已接入”
   - 一套叫“默认使用”

**证据**

- `AI 接入` 当前只统计 API/provider 选项和 `custom`  
  [src/components/settings-panel.tsx:255](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:255)
- Native 可用性来自 inventory，但没被并进已接入集合  
  [src/lib/providers/provider-inventory.ts:74](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/provider-inventory.ts:74)
- Native 可用性规则  
  [src/lib/providers/provider-availability.ts:65](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/provider-availability.ts:65)

**优先级**  
`P0`

---

### US-02 添加新的 API Provider

**用户故事**  
作为系统管理员，我希望可以添加一个新的 API Provider，例如 OpenAI、Claude、Gemini、Grok，这样系统就能调用这个厂商的模型。

**用户需求**

1. 选择 Provider
2. 输入 API Key
3. 测试连接
4. 保存接入
5. 保存后立即在“已接入”里可见

**当前支持**

1. `openai-api / claude-api / gemini-api / grok-api` 都可接入
2. 可以输入 Key
3. 可以测试连接
4. 可以保存接入

**缺失点**

1. 保存后没有独立的“接入条目”概念
2. 没有“接入已创建成功”的稳定对象视图，只是更新一份状态
3. 没有后续删除入口

**证据**

- 内联 API 接入保存  
  [src/components/settings-panel.tsx:1604](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1604)
- API Key 持久化  
  [src/server/control-plane/routes/settings.ts:139](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/server/control-plane/routes/settings.ts:139)

**优先级**  
`P1`

---

### US-03 添加新的 Custom / Compatible Provider

**用户故事**  
作为系统管理员，我希望可以接入一个自定义模型服务，例如 DeepSeek、Groq 兼容网关、Ollama、OpenAI-compatible endpoint，这样系统可以使用企业内部或第三方代理服务。

**用户需求**

1. 选择接入类型或预设
2. 输入名称
3. 输入 Base URL
4. 输入 API Key
5. 输入默认模型
6. 测试连接
7. 保存接入
8. 保存后出现在“已接入”里

**当前支持**

1. 预设模板存在
2. 表单完整
3. 可以测试连接
4. 可以保存到 `customProvider`

**缺失点**

1. 当前数据模型只支持一个 `customProvider`
2. 页面语言用了“添加接入”，但用户实际上不能管理多个 custom 接入
3. 没有删除这个 custom 接入的显式路径

**证据**

- `customProvider` 是单对象  
  [src/lib/providers/types.ts:223](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/types.ts:223)
- 自定义接入表单  
  [src/components/settings-panel.tsx:1473](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1473)

**优先级**  
`P0`

---

### US-04 识别并使用已经可用的 Native Provider

**用户故事**  
作为系统管理员，我希望如果 `Codex Native`、`Claude Code` 或 `Antigravity` 已经在本机可用，系统能直接告诉我它们已经可接入或可使用，这样我不需要猜它们到底算不算“已接入”。

**用户需求**

1. Native Provider 应该出现在“已接入 / 可用”集合里
2. 应明确显示状态：
   - 已接入
   - 未登录
   - 未安装
3. 用户能理解下一步动作：
   - 直接使用
   - 先登录
   - 先安装

**当前支持**

1. 系统能探测 `native-codex` 和 `claude-code`
2. 默认 Provider 下拉里可以选择它们
3. `凭证中心` 里有本地登录态卡片

**缺失点**

1. 这些状态没有并入主路径 `AI 接入`
2. 用户在主页面很难知道 Native Provider 已经可用
3. `Native Codex` 已 ready 但不显示在“已接入”

**证据**

- inventory 探测  
  [src/lib/providers/provider-inventory.ts:55](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/provider-inventory.ts:55)
- 本地登录态卡片在 `ApiKeysTab`，不在主路径  
  [src/components/settings-panel.tsx:2943](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:2943)

**优先级**  
`P0`

---

### US-05 选择默认 Provider 和默认模型

**用户故事**  
作为业务使用者，我希望在所有可用 Provider 中选择一个默认 Provider 和默认模型，这样系统后续运行会稳定使用我期望的配置。

**用户需求**

1. 默认 Provider 只能从可用 Provider 中选择
2. 默认模型要跟随当前 Provider
3. 如果默认 Provider 还没完成接入，页面应阻止或明确引导
4. 保存动作应清楚说明它保存的是“默认使用配置”

**当前支持**

1. 有 `默认 Provider`
2. 有 `默认模型`
3. 有 `保存默认配置`

**缺失点**

1. 当前 `默认 Provider` 和“已接入集合”不一致
2. 用户虽然能选到可用项，但无法从上方 `AI 接入` 理解这些项的来源
3. “默认使用什么”和“已经接了什么”没有统一到一个心智模型

**证据**

- 默认 Provider 选择  
  [src/components/settings-panel.tsx:1714](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1714)
- 保存默认配置  
  [src/components/settings-panel.tsx:1997](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1997)

**优先级**  
`P1`

---

### US-06 编辑一个已存在的接入

**用户故事**  
作为系统管理员，我希望可以编辑一个已存在的接入，这样当 key 轮换、endpoint 变更、默认模型调整时，我不需要重新添加一遍。

**用户需求**

1. 已存在接入必须可重新打开
2. 用户能看到当前接入类型
3. 用户可以修改后保存
4. 修改后系统状态同步更新

**当前支持**

1. API Key 型接入可以覆盖保存新 key
2. `custom` 接入可以修改字段

**缺失点**

1. 页面没有“接入列表 + 单项编辑”结构
2. 编辑动作仍然依赖用户重新切到某个类型，再手动覆盖
3. 没有清晰的“当前我正在编辑哪个接入”

**证据**

- API Key 覆盖保存  
  [src/server/control-plane/routes/settings.ts:147](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/server/control-plane/routes/settings.ts:147)
- `custom` 字段更新  
  [src/components/settings-panel.tsx:1108](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1108)

**优先级**  
`P1`

---

### US-07 删除一个已存在的接入

**用户故事**  
作为系统管理员，我希望删除一个已不再使用的接入，这样我可以保持配置干净，并避免系统继续误用旧凭证或旧端点。

**用户需求**

1. API Provider 支持删除
2. Custom Provider 支持删除
3. 删除后：
   - 不再出现在“已接入”
   - 不可被设为默认
   - 如果它正被默认使用，系统要拦截或提示迁移

**当前支持**

1. Scene 覆盖支持删除
2. Provider 接入本身不支持删除

**缺失点**

1. API Provider 无删除入口
2. Custom Provider 无删除入口
3. Native Provider 无断开/移除入口

**证据**

- Scene 删除存在  
  [src/components/settings-panel.tsx:3091](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:3091)
- Provider 接入删除不存在  
  [src/components/settings-panel.tsx:1391](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1391)
- API Key 后端仅靠空值写回清除，但前端无入口  
  [src/server/control-plane/routes/settings.ts:149](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/server/control-plane/routes/settings.ts:149)

**优先级**  
`P0`

---

### US-08 验证一个已保存接入是否仍然可用

**用户故事**  
作为系统管理员，我希望能对一个已经保存的接入再次做健康检查，这样当上游服务变更、Key 失效或权限收回时，我能快速判断问题在哪里。

**用户需求**

1. 已保存接入可直接测试
2. 不要求重新输入整串 secret
3. 测试结果区分：
   - 有效
   - 无效
   - 超时
   - 服务异常

**当前支持**

1. 支持测试当前输入值
2. 不支持对“已保存但未重新输入”的接入直接测试

**缺失点**

1. 只存 `set: boolean`，不暴露已保存接入的健康复测路径
2. 用户如果忘了 key，没法做巡检

**证据**

- 只回传 `set` 状态  
  [src/components/settings-panel.tsx:2704](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:2704)
- 测试动作依赖当前输入  
  [src/components/settings-panel.tsx:1213](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1213)
- OpenAI 测试依赖当前输入  
  [src/components/settings-panel.tsx:2816](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:2816)

**优先级**  
`P2`

---

### US-09 管理 Native Provider 的断开与恢复

**用户故事**  
作为技术管理员，我希望能明确管理 Native Provider 的断开与恢复，这样当我更换账号、切换本地环境或做故障排查时，不会被“系统自动探测”困住。

**用户需求**

1. Native Provider 需要有“断开”或“登出说明”
2. 如果不能直接在 UI 里执行 logout，也要提供：
   - 明确说明
   - 本机路径提示
   - 恢复步骤
3. Native 状态应进入“已接入 / 不可用 / 待登录”统一状态系统

**当前支持**

1. 系统会探测本地登录态
2. 系统不会提供断开操作

**缺失点**

1. 对用户来说，这类 Provider 处于“可用但不可管理”的状态
2. 缺少断开或恢复路径说明

**证据**

- Native Codex 探测  
  [src/lib/providers/provider-inventory.ts:57](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/provider-inventory.ts:57)
- Claude Code 探测  
  [src/lib/providers/provider-inventory.ts:79](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/providers/provider-inventory.ts:79)

**优先级**  
`P1`

---

### US-10 清理高级配置，回到继承默认

**用户故事**  
作为技术管理员，我希望可以删除 layer 覆盖或关闭高级配置，这样系统能回到“继承默认”的简单状态，而不是越改越复杂。

**用户需求**

1. layer 覆盖支持删除
2. 删除后回到继承默认
3. 图像配置支持明确关闭

**当前支持**

1. 图像生成支持启用/停用
2. layer 覆盖只支持编辑，不支持删除

**缺失点**

1. 没有“清除这一层覆盖”动作
2. 高级设置可以展开，但不方便真正回到默认

**证据**

- 图像开关  
  [src/components/settings-panel.tsx:1831](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1831)
- layer 覆盖只有写入，没有删除  
  [src/components/settings-panel.tsx:1061](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1061)
- layer 覆盖 UI 无删除  
  [src/components/settings-panel.tsx:1940](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/components/settings-panel.tsx:1940)

**优先级**  
`P2`

---

## 5. 用户故事需求矩阵

| User Story | 当前支持 | 关键缺失 |
|---|---:|---|
| US-01 查看已接入 Provider | 部分支持 | Native Provider 不在“已接入” |
| US-02 添加 API Provider | 支持 | 无稳定接入对象视图、无删除 |
| US-03 添加 Custom Provider | 部分支持 | 只能单槽位、无删除 |
| US-04 识别 Native Provider | 部分支持 | 主旅程不可见、已接入集合缺失 |
| US-05 选择默认 Provider/模型 | 支持 | 与“已接入”集合不一致 |
| US-06 编辑接入 | 部分支持 | 缺少接入列表和单项编辑心智 |
| US-07 删除接入 | 不支持 | API / Custom / Native 都缺删除或断开 |
| US-08 复测已保存接入 | 不支持 | 必须重新输入 secret |
| US-09 管理 Native 断开/恢复 | 不支持 | 无断开、无恢复说明 |
| US-10 清理高级配置 | 部分支持 | layer 覆盖无法删除 |

---

## 6. 产品缺口优先级

### P0：必须先补

1. **统一“已接入”真相源**  
   `AI 接入` 必须覆盖 API / Native / Custom，不允许再出现“默认用 native-codex，但已接入只显示 OpenAI API”

2. **补全删除旅程**  
   - 删除 API 接入  
   - 删除 custom 接入  
   - 断开 native 接入或给出清晰断开说明

3. **修正 Custom 接入模型**  
   决定到底是：
   - 只允许一个 custom 接入  
   - 还是支持多个 external connections  

### P1：第二优先级

1. Native Provider 主旅程可见
2. 接入对象化，而不是只有散落表单
3. 编辑接入时有明确“当前正在编辑哪个接入”
4. 默认配置与接入集合保持一致

### P2：第三优先级

1. 支持复测已保存接入
2. 支持清除 layer 覆盖
3. 保护未保存草稿，避免切换即丢

---

## 7. 最关键的产品判断

当前 Provider 页最大的产品问题不是样式，而是：

> **系统还没有真正建立“接入对象”这个产品概念。**

现在页面里存在的是：

1. 一些可探测状态
2. 一些可保存字段
3. 一个默认 Provider 选择器

但还没有形成用户可理解的完整对象：

1. 这个 Provider 已接入了吗？
2. 它是谁？
3. 我可以编辑它吗？
4. 我可以删除它吗？
5. 它为什么可用/不可用？
6. 它现在是不是系统默认？

这就是为什么用户会直接感受到：

1. Native Codex 已启用，但不算已添加
2. 只有添加，没有删除
3. 默认使用和已接入像两套系统

---

## 8. 下一步改造建议

如果按产品经理方式推进，下一轮不应该先修文案，而应该先做信息架构：

1. 建立统一的 `已接入 Provider` 列表
2. 每个接入条目支持：
   - 查看状态
   - 编辑
   - 设为默认
   - 删除 / 断开
3. `默认配置` 只消费这个“已接入列表”
4. `高级设置` 再消费默认配置，而不是反向补洞

这会比继续局部收控件更有效。

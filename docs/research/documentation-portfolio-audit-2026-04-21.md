# 文档资产审计与清理建议

日期：2026-04-21

## 结论摘要

当前文档体系的主要问题，不是“缺文档”，而是：

1. **入口文档失真**
2. **历史分析文档没有及时归档**
3. **索引文档仍把已过时材料当成现行说明**

尤其是最近完成了：

1. `groupId / /api/agent-groups` 公共契约淘汰
2. `web / control-plane / runtime / scheduler` split
3. 首页与 CEO / Department / Workspace 旅程重构

但多个入口文档仍停留在旧叙事，因此现在最该做的不是继续堆新文档，而是：

1. **先修正入口层文档**
2. **再清理已完成使命的旧分析文档**

---

## 一、必须优先更新的文档（P0）

这些文档属于“用户或新开发者第一眼就会看到”的入口文档，当前内容已经会造成误导。

### 1. `README.md`

当前问题：

1. 仍然出现 `groupId`
2. 仍然出现 `/api/agent-groups`
3. 仍然把系统描述成单端口单体服务
4. 架构图区分不出 `web / control-plane / runtime / scheduler`

建议更新：

1. 把所有 `groupId` 派发示例改为 `templateId + stageId` 或当前真实 `agent-runs` 契约
2. 删掉 `/api/agent-groups` 相关 API 表
3. 把“单端口服务”改为：
   - 默认可一体启动
   - 但工程上支持 `web / control-plane / runtime / scheduler` 分角色运行
4. 架构图区分：
   - `web`
   - `control-plane`
   - `runtime`
   - `scheduler`

### 2. `README_EN.md`

当前问题：

1. 仍然写 `server.ts # Custom server: Next.js + WebSocket on single port`
2. API 概览仍按旧单体和旧 conversations merge 口径描述

建议更新：

1. 与中文 README 同步 split 叙事
2. 修正 API 一览中的热路径描述
3. 补充 split-mode / role-based deployment 简述

### 3. `docs/README.md`

当前问题：

1. 把 `user-journey-gaps.md` 放在“设计与规划”里，且注明“已全部修复”
2. `agent-user-guide.md` 描述仍然写成 “Group、Pipeline、Workflow”
3. 没有体现最新 split 架构和最新研究文档的主索引关系

建议更新：

1. 新增“当前主入口文档”分组：
   - `ARCHITECTURE.md`
   - `docs/guide/gateway-api.md`
   - `docs/guide/cli-api-reference.md`
   - `docs/guide/agent-user-guide.md`
   - `docs/PROJECT_PROGRESS.md`
2. 新增“历史/归档材料”分组
3. 将明显过时文档从默认索引移出

### 4. `docs/doc-maintenance.md`

当前问题：

1. 维护清单仍围绕 `src/app/api/route.ts` 和 `group-runtime` 老主线
2. 没有覆盖新的 `src/server/control-plane/*` / `src/server/runtime/*`
3. 没有覆盖“入口 route 变薄、共享 handler 下沉”的新结构

建议更新：

1. 新增检查项：
   - 改了 `src/server/control-plane/routes/*` → 更新 `gateway-api.md` / `cli-api-reference.md` / `ARCHITECTURE.md`
   - 改了 `src/server/runtime/routes/*` → 更新 runtime 归属说明和 API 文档
2. 把“改了 group-runtime 执行流程？”降级为运行时专项项，不再当成所有任务的中心检查点

---

## 二、应该尽快更新的文档（P1）

这些文档不会立刻误导新用户，但已经和当前代码状态有明显偏差。

### 1. `docs/guide/agent-user-guide.md`

当前状态：

1. 主体内容基本仍可用
2. 但入口描述仍带较重的历史 `Group` 叙事

建议：

1. 在前几章增加：
   - stage-centric / inline-only 现状
   - split 角色说明
   - control-plane vs runtime 的职责边界
2. 弱化“Group 是公共对象”的表述

### 2. `docs/guide/mcp-server.md`

建议补充：

1. `MCP` 配置接口归属 `control-plane`
2. split 模式下 `web` 仅代理 MCP 配置类 HTTP 接口

### 3. `docs/guide/remote-access.md`

建议补充：

1. 如果未来 remote access 走 split 部署，推荐暴露的入口仍是 `web`
2. `control-plane/runtime` 默认不直接面向公网

### 4. `docs/OPC_next.md`

当前状态：

1. 仍有很多旧架构叙事
2. 仍把 `group-runtime` 当成绝对中心

建议：

1. 不删
2. 但要明确标注“这是路线规划/历史设计，不代表当前实现全貌”

---

## 三、建议归档或删除的文档（P0-P1）

这些文档的价值已经主要是“历史材料”，不应继续作为活跃文档暴露在主索引里。

### A. 建议直接删除

#### 1. `docs/.DS_Store`

理由：

1. 不是文档
2. 纯 Finder 垃圾文件

### B. 建议删除，不要再保留正文

#### 2. `docs/guide/agent-user-guide-v5-legacy.md`

理由：

1. 文件名已明确是 `legacy`
2. 标题仍是 `V5.4`
3. 仍大量使用 `Agent Groups` 叙事

处理建议：

1. 删除旧版正文
2. 如有历史路径依赖，只保留短 stub

#### 3. `docs/frontend-gap-analysis.md`

理由：

1. 标题是“差距分析”
2. 内容仍写：
   - `/api/agent-groups`
   - 前端 gap
   - 已被后续多轮实现覆盖
3. 已不适合作为当前状态说明

处理建议：

1. 直接删除
2. 不再作为现行前端说明文档

#### 4. `docs/user-journey-gaps.md`

理由：

1. 文档顶部已经写明“全部修复完成”
2. 更适合作为历史验收记录
3. 不应继续留在 `docs/README.md` 主索引里

处理建议：

1. 直接删除
2. 从索引移除

#### 5. `docs/template-vs-group-analysis.md`

理由：

1. 整份文档围绕 `groupId`、`groups{}`、`/api/agent-groups`
2. 当前公共契约已经去 group 化
3. 只保留历史参考价值

处理建议：

1. 直接删除
2. 不应再被误读为当前架构说明

---

## 四、建议保留但明确标注“历史/研究材料”的文档

以下文档可能仍有研究价值，不建议直接删除，但应明确和“当前实现文档”隔离：

1. `docs/agent_research/*`
2. `docs/internals/*`
3. 多数 `docs/research/*`
4. `docs/multi-agent-redundancy-report.md`
5. `docs/claude-engine-gap-analysis.md`
6. `docs/claude-code-frontend-needs.md`

建议做法：

1. 在 `docs/README.md` 中单独分组为：
   - 当前有效文档
   - 历史/研究文档
2. 不要让新读者把这些材料当成“当前系统真相源”

---

## 五、建议的清理顺序

### 第一步：修入口

1. `README.md`
2. `README_EN.md`
3. `docs/README.md`
4. `docs/doc-maintenance.md`

### 第二步：删除历史正文

1. `docs/guide/agent-user-guide-v5-legacy.md`
2. `docs/frontend-gap-analysis.md`
3. `docs/user-journey-gaps.md`
4. `docs/template-vs-group-analysis.md`

### 第三步：再做深层导览整理

1. `docs/guide/agent-user-guide.md`
2. `docs/guide/mcp-server.md`
3. `docs/guide/remote-access.md`
4. `docs/OPC_next.md`

---

## 六、最终判断

如果只允许做少量高收益动作，优先级应该是：

1. **立刻更新**：`README.md`、`README_EN.md`、`docs/README.md`
2. **立刻删除正文**：`agent-user-guide-v5-legacy.md`、`frontend-gap-analysis.md`、`user-journey-gaps.md`、`template-vs-group-analysis.md`
3. **稍后补齐**：`docs/doc-maintenance.md`、`docs/guide/agent-user-guide.md`

否则继续堆新文档，只会让“入口是旧的，细节是新的，历史材料又混在主索引里”的问题越来越重。

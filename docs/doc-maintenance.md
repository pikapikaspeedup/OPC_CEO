# 文档维护规则

> 以当前仓库工作流为准：代码和行为是真相源，文档必须同步，但 `PROJECT_PROGRESS.md` 只记录已经落地且验证通过的实现。

---

## 一、文档分层

| 层级 | 文档位置 | 作用 | 何时更新 |
|------|----------|------|----------|
| L0 | `README.md` / `README_EN.md` | 项目入口与启动方式 | 对外入口、启动模型、产品定位变化时 |
| L1 | `ARCHITECTURE.md` | 当前系统结构与关键文件 | 模块拆分、角色边界、依赖关系变化时 |
| L2 | `docs/guide/*` | 当前可用功能、API、集成方式 | 功能/API/配置变化时 |
| L3 | `docs/design/*` | 设计方案、约束、演进方案 | 设计讨论和方案沉淀时 |
| L4 | `docs/research/*` | 时间点审计、问题复盘、性能研究 | 调研、审计、复盘时 |
| L5 | 已删除文档 / 短 stub | 已确认废弃且不应再被检索的旧文档 | 文档被正式下线时 |
| 进度 | `docs/PROJECT_PROGRESS.md` | 已完成且验证通过的实现记录 | 代码/配置/数据改动完成并验收后 |

---

## 二、`PROJECT_PROGRESS.md` 使用边界

只在以下场景更新：

1. 代码改动已完成
2. 配置或数据行为已变化
3. 已做测试/构建/验收并有证据

以下场景不要更新：

1. 只读分析
2. 纯文档治理
3. 方案讨论
4. 历史梳理
5. 尚未落地的设计结论

这类内容应写入：

1. `docs/design/`
2. `docs/research/`

---

## 三、代码改动后的同步规则

| 代码变更 | 必须同步更新的文档 |
|----------|-------------------|
| `src/app/api/` 路由变更 | `docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`ARCHITECTURE.md` |
| 角色拆分 / 模块重构 | `ARCHITECTURE.md` |
| Template / Stage / Department 行为变化 | `docs/guide/agent-user-guide.md` |
| MCP / Tunnel / WeChat / Obsidian 行为变化 | 对应 `docs/guide/*` |
| 启动方式 / 仓库入口变化 | `README.md`、`README_EN.md` |

---

## 四、过时文档处理策略

### 1. 仍是活动文档

如果文档仍位于主入口、主索引或 `docs/guide/` 中，就必须直接修正到当前事实，不能放任其带着已知错误继续存在。

### 2. 需要保留历史背景

如果文档对理解历史演进仍有价值，但已经不代表当前事实：

1. 在顶部加明确的“历史/已过时”说明
2. 从 `docs/README.md` 的主入口降权
3. 不再把它当作当前 API / 当前架构 / 当前状态依据

### 3. 明确 legacy

如果文档已经被新文档完全替代，且继续留在原位置会误导检索：

1. 默认直接删除正文
2. 只有在老路径仍被引用时，才保留一个短 stub
3. stub 只说明“已删除/已替代”，不再保留整份旧内容

---

## 五、检查清单

每次提交前至少确认：

- [ ] 入口文档没有引用已删除接口
- [ ] `README` / `ARCHITECTURE` / `guide` 之间术语一致
- [ ] 活动文档里没有已知的旧路径、旧契约、旧架构图
- [ ] 历史文档已明确标识，不在主索引冒充现行文档
- [ ] 如果改的是代码而不是纯文档，`PROJECT_PROGRESS.md` 只在验证后更新

---

## 六、快速检测命令

### 检查旧契约残留

```bash
rg -n "groupId|/api/agent-groups|dispatch-group" README.md README_EN.md ARCHITECTURE.md docs
```

### 检查过时入口文档

```bash
rg -n "docs/GATEWAY_API.md|docs/API_REFERENCE.md|Single Port|单端口服务" README.md README_EN.md docs
```

### 检查活动指南是否混入旧版正文

```bash
rg -n "^# " docs/guide/agent-user-guide.md
```

如果同一活动文档里出现多个完整重复标题块，优先清理，而不是再新增一份“新版本”。

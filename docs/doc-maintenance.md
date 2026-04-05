# 文档维护最佳实践

> 基于 2026-04-05 四轮文档对齐实战总结。

---

## 一、核心原则

```
代码改了 → 文档必须改
文档落后 = 技术债
```

---

## 二、文档分层与责任矩阵

| 层级 | 文档 | 触发更新的变更 | 更新时机 |
|:-----|:-----|:-------------|:---------|
| **L0 架构** | `ARCHITECTURE.md` | 新模块/新子系统/模块拆分/依赖变更 | 每次架构级变更后 |
| **L1 用户指南** | `docs/guide/agent-user-guide.md` | 新功能/新概念/新配置项 | 功能开发完成后 |
| **L2 API 参考** | `gateway-api.md` / `cli-api-reference.md` | 新 API 端点/参数变更/响应格式变更 | route.ts 变更后 |
| **L3 专题** | `mcp-server.md` / `cli-guide.md` / setup 指南 | 对应领域的实现变更 | 相应功能变更后 |
| **L4 进度** | `PROJECT_PROGRESS.md` | **任何任务完成后** | 每次任务完成 |

---

## 三、文档同步检查清单

每次任务完成时，逐条检查：

- [ ] **改了 `src/app/api/` 下的 route.ts？**
  → 更新 `gateway-api.md` + `cli-api-reference.md` + `ARCHITECTURE.md` API 总览表

- [ ] **新增了 `src/lib/` 下的模块？**
  → 更新对应 `ARCHITECTURE.md` 章节的"关键文件"表

- [ ] **新增了子系统（新目录如 `src/lib/security/`）？**
  → `ARCHITECTURE.md` 新增章节 + 模块依赖关系图更新 + `agent-user-guide` 新增对应节

- [ ] **修改了数据模型/接口（`types.ts` 变更）？**
  → 检查 `agent-user-guide` 中的字段表是否需要更新

- [ ] **修改了 group-runtime 执行流程？**
  → 检查 `agent-user-guide` 的运行生命周期 / review 机制是否过时

- [ ] **新增了配置项/环境变量？**
  → 更新 `agent-user-guide` 对应的配置示例 + `cli-guide` 环境变量章节

- [ ] **重构拆分了模块？**
  → 更新 `ARCHITECTURE.md` 关键文件表 + 模块依赖关系图

---

## 四、定期审查节奏

| 频率 | 审查内容 | 方法 |
|:-----|:---------|:-----|
| **每次任务完成** | `PROJECT_PROGRESS.md` | 记录做了什么、改了哪些文件 |
| **每周** | `ARCHITECTURE.md` vs 代码 | API 路由数对比 + 模块文件数对比 |
| **每个版本** | 全量审查 | 逐章读 ARCHITECTURE.md，验证关键文件是否存在 |
| **重构后** | 模块依赖关系图 | 检查引用关系是否还成立 |

---

## 五、自动化检测命令

### API 路由覆盖检测

找出代码有但文档没有的路由：

```bash
# 代码中的路由
code_routes=$(find src/app/api -name route.ts | sed 's|src/app/||;s|/route.ts||' | sort)

# 文档中的路由
doc_routes=$(grep '/api/' ARCHITECTURE.md | grep -oP '/api/[^\s|`]+' | sed 's|`||g' | sort -u)

# 差异
comm -23 <(echo "$code_routes") <(echo "$doc_routes")
```

### 模块覆盖检测

找出 agents 目录下有但 ARCHITECTURE.md 没引用的模块：

```bash
comm -23 \
  <(ls src/lib/agents/*.ts | grep -v test | sed 's|.*/||;s|\.ts||' | sort) \
  <(grep 'agents/' ARCHITECTURE.md | grep -oP '[a-z-]+\.ts' | sed 's|\.ts||' | sort -u)
```

### 快速数据对比

```bash
echo "API routes in code: $(find src/app/api -name route.ts | wc -l)"
echo "API routes in ARCHITECTURE.md: $(sed -n '/REST API/,/技术栈/p' ARCHITECTURE.md | grep '/api/' | wc -l)"
echo "Agent modules: $(ls src/lib/agents/*.ts | grep -v test | wc -l)"
echo "Agent modules documented: $(grep 'agents/.*\.ts' ARCHITECTURE.md | wc -l)"
```

---

## 六、防退化规则

1. **PR/任务完成前必检文档** — 与代码 review 同等重要
2. **ARCHITECTURE.md 的章节数 ≥ 系统子系统数** — 一个子系统一个章节
3. **API 表行数 ≈ route.ts 文件数** — 偏差超过 5% 触发审查
4. **关键文件表包含所有 > 100 行的模块** — 小模块可省略，大模块必须记录
5. **PROJECT_PROGRESS 是唯一的变更日志** — 不要在 ARCHITECTURE.md 里记录"何时改了什么"

---

## 七、教训总结

| 问题 | 原因 | 预防 |
|:-----|:-----|:-----|
| Provider/OPC 文档完全空白 | 新子系统开发时没有同步建章节 | **新目录 = 新 ARCHITECTURE 章节** |
| Agent §2 关键文件仅 7/19 | group-runtime 拆分后没更新 | **重构完成后必须更新文件表** |
| Security 无 guide | 安全模块是"内部基础设施"心态 | **即使是内部模块也要有用户 guide** |
| Scheduler/Deliverables API 无文档 | route.ts 加了但忘更新 API 文档 | **route.ts 变更 → 检查清单** |
| API 总览表缺 5 条路由 | ARCHITECTURE.md 是手工维护的 | **定期运行自动检测命令** |

---

## 八、当前文档覆盖状态（2026-04-05）

### ARCHITECTURE.md 结构（12 章 + 3 附录）

| 章节 | 关键文件数 | guide 覆盖 |
|------|-----------|-----------|
| §1 Conversation | — | gateway-api + cli-guide |
| §2 Agent | 19 | agent-user-guide §1-§12 |
| §3 Project | 16 | agent-user-guide + graph-pipeline-guide |
| §4 MCP | — | mcp-server.md |
| §5 Codex | 5 | gateway-api |
| §6 Provider | 5 | agent-user-guide §20 |
| §7 OPC | 11 | agent-user-guide §21 |
| §8 Security | 7 | agent-user-guide §22 |
| §9 Scheduler | 2 | agent-user-guide §23 |
| §10 CLI | — | cli-guide + cli-api-reference |
| §11 WeChat | — | wechat-setup.md |
| §12 Obsidian | — | obsidian-setup.md |

### API 覆盖

- 代码路由文件：75 个
- ARCHITECTURE.md 表条目：76 条
- gateway-api.md 端点：~80 个
- cli-api-reference.md 分节：10 个

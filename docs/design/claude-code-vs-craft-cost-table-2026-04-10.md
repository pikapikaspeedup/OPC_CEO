# Claude Code vs Craft 成本表

日期：2026-04-10  
状态：决策文档 / 成本评估

## 一句话结论

如果目标只是：

1. 尽快得到一个强 coding executor

那最便宜的路线不是“把 Claude Code 改造成 Craft”，而是：

1. **直接把 Claude Code 接成第一代外部 executor**

如果目标变成：

1. 不只接 Claude Code
2. 还希望它最终长得更像 Craft 那种干净的 execution shell / session substrate

那成本会明显抬升，而且这笔成本里最贵的不是一次性改代码，而是：

1. **长期维护一个被你深改过的 Claude Code 分叉**

---

## 1. 先把三种路线分开

很多时候讨论会混成一句“改 Claude Code 还是借 Craft”，但其实有 3 条不同路线。

## 路线 A：直接接 Claude Code，当第一代 coding executor

目标：

1. 快速落地
2. 让它在现有 execution seam 后面跑起来
3. 不强求它长成统一 runtime substrate

## 路线 B：接 Claude Code，但继续把它改造成更像 Craft 的 execution shell

目标：

1. 先利用 Claude Code 的现成能力
2. 再把它内部壳层、session、事件、权限、中间件慢慢收成更干净的 substrate

## 路线 C：直接以 Craft 思路为主，自己做或深借 Craft-style runtime

目标：

1. 长期 runtime 品质更高
2. session / backend / event / capability 分层更统一
3. 从一开始就按 execution substrate 视角设计

---

## 2. 成本结论先说

如果只看总成本和成功率，我会这样排：

1. **最便宜**：路线 A
2. **最贵**：路线 B
3. **长期最干净但启动成本高**：路线 C

为什么路线 B 最贵：

1. 你先付一遍 Claude Code 接入成本
2. 再付一遍把它“去产品壳、去自带 runtime 假设、变成 Craft-like substrate”的改造成本
3. 以后还要长期付 Claude Code 上游演进带来的 fork 税

也就是说：

1. **把 Claude Code 改成更像 Craft，通常比“直接用 Claude Code”贵很多**
2. **而且往往比“从一开始就按 Craft-style substrate 做”还更拧巴**

---

## 3. 成本表

下面这张表只比较“外部 executor 落地”相关工程成本，不算你平台控制层本来就必须做的工作。

| 维度 | 路线 A：直接接 Claude Code | 路线 B：把 Claude Code 改成更像 Craft | 路线 C：直接借 Craft 思路 / 自建 Craft-style runtime |
|:---|:---|:---|:---|
| 首次可跑通 PoC | 低 | 中高 | 高 |
| 现成 coding 能力复用 | 高 | 高 | 中 |
| session / backend / event 壳清洁度 | 中 | 中高 | 高 |
| 去产品壳改造成本 | 低 | 高 | 中 |
| 长期维护成本 | 中 | 高 | 中高 |
| fork 税 | 中 | 很高 | 低到中 |
| 适合短期落地 | 很高 | 中 | 低 |
| 适合长期 runtime 标准化 | 中 | 中 | 很高 |

---

## 4. 如果“Claude Code 要变成更像 Craft”，具体贵在哪

这部分才是你真正关心的代价。

## 4.1 Session 语义重整成本

Claude Code 里当然也有 session / conversation / tool loop，但它们是围绕 Claude Code 自己的产品运行时组织的。

如果你想把它变成更像 Craft 的 substrate，你要做的不是“把 session 抽出来”这么简单，而是：

1. 重新界定 session 的 ownership
2. 把 session 从产品壳语义里剥出来
3. 让 session 更像一个被平台控制的 execution thread

这是中高成本。

原因：

1. 不是改一个接口
2. 是要清掉很多默认产品假设

## 4.2 UI / 产品壳去耦成本

Claude Code 最大的现实优势之一，是它已经是一个很强的产品。

但这也正是把它改成 Craft-like substrate 的成本来源。

你要持续识别并拆掉这些东西：

1. 它默认的 REPL / TUI / 交互假设
2. 它自己的 session 管理方式
3. 它自己的 tool permission / user interaction flow
4. 它自己的状态与消息组织方式

这部分通常是高成本，而且很容易做着做着就变成长期 fork。

## 4.3 Tool / permission / middleware 重构成本

Craft 的优点之一，是它更像一个 clean runtime substrate。

如果你希望 Claude Code 也往这个方向靠，你很可能要继续补：

1. 更明确的 capability 层
2. 更统一的 tool middleware
3. 更可控的 permission / approval 流
4. 更好挂 PI SDK / session SDK 的接缝

这不是简单“加几个 adapter”，而是中高到高成本的 runtime 再组织。

## 4.4 上游演进带来的 fork 税

这是最容易低估的部分。

一旦你把 Claude Code 深改成自己的 Craft-like runtime：

1. 你以后就不能轻松吃上游更新
2. 每次合并上游都要重新处理被你改过的 session、event、tool、UI、provider 相关代码
3. 你会逐渐拥有一个“名义上来自 Claude Code，实际上已经是你自己产品分叉”的系统

这部分不是一次性成本，而是长期 recurring cost。

---

## 5. 粗量级时间 / 复杂度判断

这里只给粗量级，不给假精确天数。

## 路线 A：直接接 Claude Code

粗量级：低到中。

更像：

1. 做 executor adapter
2. 做 run / stage / result contract 映射
3. 接 provider / tools / workspace / artifact 回传

这是“先跑起来”的路线。

## 路线 B：Claude Code 变得更像 Craft

粗量级：高。

更像：

1. 先接 Claude Code
2. 再系统性拆它的产品运行时假设
3. 再持续维护你自己的深改分叉

这是“二次投资最多”的路线。

## 路线 C：直接借 Craft 思路 / 自建 Craft-style runtime

粗量级：中高到高。

更像：

1. 初期更慢
2. 但长期架构更统一
3. 不用背 Claude Code 深改分叉的长期包袱

---

## 6. session 是不是就等于我们的 Conversation

不是。

它们很像，但不能直接等同。

更准确的映射是：

1. 平台层：Project / Run / Stage
2. 执行线程层：Conversation / childConversationId / external session handle
3. 外部 runtime 内部：Claude Code session / Craft session

所以：

1. Craft 的 session 更像你“希望外部执行线程长什么样”
2. 但它仍然只能映射到你平台里的 execution thread / Conversation 层
3. 不能反过来取代平台的 Run / Stage 真相源

也正因为这个原因：

1. 如果你为了“像 Craft”而把 Claude Code 的 session 语义抬升成平台主语义，就会付出更大的架构改造代价

---

## 7. 我给你的现实建议

如果目标是工程上最划算，我建议这样走。

## 7.1 现在

1. 先走路线 A
2. 让 Claude Code 成为第一代默认 coding executor
3. 不急着把它改造成 Craft-like substrate

## 7.2 同时

1. 在你自己的 execution seam 上保留 Craft-style 的抽象方向
2. 借 Craft 的 session / backend / event / capability 思路继续净化你自己的 runtime contract

## 7.3 以后

1. 如果 Claude Code 证明足够稳定，就继续当强 coding executor
2. 如果长期确实需要更干净的 substrate，再决定是继续自建 Craft-style runtime，还是抽一层更统一的 execution shell

---

## 8. 最后一句话

如果你问的是：

1. **把 Claude Code 直接接进来贵不贵**

答案是：

1. 不算最贵，反而是当前最划算的落地路线。

如果你问的是：

1. **把 Claude Code 改造成更像 Craft，贵不贵**

答案是：

1. **很贵，而且最贵的部分是长期 fork 税，不是第一轮接入。**
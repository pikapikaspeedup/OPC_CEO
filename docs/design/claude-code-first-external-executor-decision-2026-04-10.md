# 决策：Claude Code 作为第一优先第三方外部执行器

日期：2026-04-10  
状态：决策已确认

## 决策结论

是。

当前应该把 Claude Code 作为：

1. **第三方外部执行器 / provider adapter 的第一优先落地点**

但这个结论必须带 3 个边界条件。

## 边界 1

这不等于：

1. 把平台基座交给 Claude Code

平台真相源仍然必须是：

1. Project
2. Run
3. Stage
4. artifact / result contract
5. intervention / scheduler / governance 语义

## 边界 2

这不等于：

1. Claude Code 成为唯一第三方执行器

它只是：

1. 第一优先接入对象
2. 第一代默认强 coding executor

后面仍然可以：

1. 保留 Native Executor
2. 接 Direct Open API backend
3. 继续借 Craft 思路或未来接入 Craft-style runtime

## 边界 3

这不等于：

1. 现在就要把 Claude Code 改造成 Craft

当前更合理的路线是：

1. 先把 Claude Code 接成第一代外部 executor
2. 长期继续借 Craft 的 session / backend / event / capability 思路净化 execution seam

---

## 为什么是 Claude Code，而不是现在就主打 Craft

## 1. 它更接近当前最缺的东西

现在最缺的是：

1. 一个能尽快落地的强 coding executor

Claude Code 在这个问题上更接近现成答案：

1. workspace 内真实执行成熟
2. coding/tool loop 更强
3. provider 兼容层现成度更高
4. 更适合作为第一代默认 coding executor PoC

## 2. 接入成本最低

如果只看现在的工程成本：

1. 直接接 Claude Code 的成本低于“先借 Craft 思路自己做壳”
2. 也低于“先接 Claude Code，再把它改造成更像 Craft”

## 3. Task B 已经为它清出接缝

Task B 完成后：

1. `group-runtime.ts` 不再直接持有 evaluate recent steps / annotation / Native runtime resolver 细节
2. execution seam 已经足够干净，可以开始做外部 executor PoC

因此现在让 Claude Code 先上，是顺着当前最低阻力路径走。

---

## 为什么仍然要继续借 Craft

因为 Craft 的价值主要不在“马上替掉 Claude Code”，而在：

1. 它更像长期 execution shell 的参考实现
2. 它的 PI SDK、session、backend、event 分层更适合指导下一代 runtime 设计

所以最合理的组合不是：

1. Claude Code 或 Craft 二选一

而是：

1. **短期先接 Claude Code**
2. **长期继续借 Craft 的结构思路**

---

## 最准确的一句话

当前应该把 Claude Code 定位成：

1. **第一优先接入的第三方外部执行器**
2. **第一代默认强 coding executor**

但不应该把它定位成：

1. 平台基座
2. 唯一执行器
3. 必须被改造成 Craft 的对象
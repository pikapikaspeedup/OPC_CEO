# 首页壳层优化设计（2026-04-21）

## 目标

本轮不是重写全部首页，而是先把首页从“默认进入 OPC 的超级控制面”收回到一个更合理的第一阶段形态：

1. `/` 有明确的首页落点
2. 首页不再默认挂侧栏和全局上下文树
3. 进入不同 section 时再按需加载对应数据
4. `CEO Office` 不再在切页时自动创建会话
5. setup 回流入口从一次性弹层改成常驻入口

## 实施点

## 1. 新增 `overview` 作为默认 section

涉及：

1. `src/lib/app-url-state.ts`
2. `src/app/page.tsx`
3. `src/components/home-overview.tsx`

策略：

1. URL 默认 section 从 `projects` 改为 `overview`
2. header 主导航新增 `Home`
3. 首页主内容改为显式入口分流：
   - `CEO Office`
   - `OPC`
   - `Chats`
   - `Knowledge`
   - `Ops`
   - `Settings`
4. 首页直接展示：
   - setup 状态
   - continue-work 入口
   - active runs / approvals / active projects / departments 统计

## 2. 首页默认不挂 Sidebar

涉及：

1. `src/app/page.tsx`
2. `src/lib/home-shell.ts`

策略：

1. `overview` 和 `settings` 下不再渲染 sidebar
2. 只有进入具体工作区 section 后才显示对应侧栏

结果：

1. 首屏不再立刻触发 Sidebar 的额外全局拉数
2. 首页视觉上回到“入口页”，而不是直接进入上下文树

## 3. 按 section 惰性加载首页数据

涉及：

1. `src/app/page.tsx`
2. `src/lib/home-shell.ts`

策略：

1. `models` 继续在首页初始化
2. `templates` 改为在 `projects / ceo` 段按需加载
3. `skills / workflows` 改为在 `ceo / conversations` 段按需加载
4. `rules / discovered*` 改为在 `operations` 段按需加载
5. `agentState` 和 header signal poll 改为按 section 使用不同刷新频率

## 4. Sidebar 改成 section-aware load

涉及：

1. `src/components/sidebar.tsx`
2. `src/lib/home-shell.ts`

策略：

1. `projects` 只加载 runtime/workspace 相关上下文
2. `conversations` 只加载 conversations + runtime
3. `ceo` 只加载 CEO history 所需 conversations
4. `knowledge` 只加载 knowledge items
5. `operations` 只加载 ops assets + runtime

这一步并没有完全消除 Home 与 Sidebar 的所有重复数据，但已经把“每个 section 一进来就把所有数据都拉一遍”收掉了。

## 5. CEO 会话创建从隐式副作用改成显式动作

涉及：

1. `src/app/page.tsx`

策略：

1. 进入 `CEO Office` 时，如果已有 CEO conversation，则仍自动选择已有会话
2. 如果没有 CEO conversation，则只切到 CEO section，不再自动 `POST /api/conversations`
3. 左侧主聊天区渲染空态 CTA，让用户显式点击“创建 CEO 对话”

这样可以避免“切页面 = 自动建对象”的隐式副作用。

## 6. setup 回流入口常驻化

涉及：

1. `src/app/page.tsx`
2. `src/components/home-overview.tsx`

策略：

1. 首页 overview 持续展示 setup status
2. `Projects` 里即使用户点过“稍后”，也继续显示轻量回流卡片
3. setup 完整入口统一通过 `openOnboardingJourney()` 收口

## 非目标

本轮没有做这些事：

1. 没有把 `Settings` 升成一级独立 section
2. 没有拆掉 `page.tsx` 里的所有控制面逻辑
3. 没有处理 `server.ts start` 仍会初始化 scheduler/registry 的后台噪音
4. 没有统一 Home / Sidebar / Ops 的所有共享数据源

这些仍是后续阶段要继续推进的内容。

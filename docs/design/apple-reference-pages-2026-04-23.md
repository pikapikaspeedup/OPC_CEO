# Apple-Style Main Page References

日期：2026-04-23

本轮将主页面设计示意图统一收口为 `5` 个一级页面，并采用更接近苹果产品设计语言的浅色体系：

- 雾白 / 珍珠银 / 软灰
- 石墨文字
- 浅蓝灰状态色
- 少量柔和青色正向提示

## 页面清单

1. `CEO Office`
   - [ceo-office.png](./mockups/apple-reference-pages-2026-04-23/ceo-office.png)
2. `Projects`
   - [projects.png](./mockups/apple-reference-pages-2026-04-23/projects.png)
3. `Knowledge`
   - [knowledge.png](./mockups/apple-reference-pages-2026-04-23/knowledge.png)
4. `Ops`
   - [ops.png](./mockups/apple-reference-pages-2026-04-23/ops.png)
5. `Settings`
   - [settings.png](./mockups/apple-reference-pages-2026-04-23/settings.png)

## 页面角色

- `CEO Office`
  - 默认首页，负责公司态势、下令、决策处理、日报与例行节奏
- `Projects`
  - 公司执行工作面，负责项目树、执行链路、阻塞与推进
- `Knowledge`
  - 知识工作面，负责沉淀、阅读、编辑、引用和关联
- `Ops`
  - 运行控制面，负责 scheduler、系统状态、连接、配额和资产
- `Settings`
  - 配置中心，负责 profile、provider、API keys、scene、MCP、消息平台

## UX 约束

- 不再单独保留 `Home` 作为最终态一级页面
- `CEO Office` 是默认进入页，但不吞并其他一级页面
- `Projects / Knowledge / Ops / Settings` 继续保持一级入口
- `Chats` 更适合作为线程工作态，而不是长期保留为一级主页面

## 当前前端栈核对

当前仓库前端不是 `Ant Design` 栈，主线依赖是：

- `Next.js 16`
- `React 19`
- `shadcn/ui`
- `Radix`
- `Tailwind CSS 4`

因此，本轮设计稿仅作为 UX / IA / 视觉参考，不代表要切到 `Ant Design 6`。

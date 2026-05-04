# 微信 × Antigravity Gateway 设置指南

> 通过 Claude Connect (cc-connect) + ACP 适配器，在微信中使用 Antigravity AI Agent。

---

## 系统架构

```
微信用户 → cc-connect (Go) → antigravity-acp.ts (ACP 适配器) → Gateway REST + WebSocket → Language Server
```

三个组件各自独立运行：
1. **cc-connect** — 微信网关（Go 项目，独立安装）
2. **antigravity-acp.ts** — ACP 适配器（本项目提供，通过 stdio JSON-RPC 连接）
3. **Antigravity Gateway** — 主服务（本项目，`npm run dev`）

---

## 前置条件

- [Go 1.21+](https://go.dev/dl/)
- [Node.js 18+](https://nodejs.org/)
- 本项目已 clone 且 `npm install` 完成
- Antigravity 桌面应用已安装并已登录

---

## 步骤 1：安装 cc-connect

```bash
go install github.com/chenhg5/cc-connect@latest
```

> 如果需要 ANP 协议支持，需从源码编译 cc-connect（见下方"源码编译"章节）。

验证安装：
```bash
cc-connect version
```

---

## 步骤 2：绑定微信

```bash
cc-connect weixin setup --project antigravity
```

按提示操作：
1. 在终端显示的页面中扫码登录微信（用于绑定客服消息通道）
2. 绑定成功后会自动生成 `token`、`base_url`、`account_id`

---

## 步骤 3：配置 cc-connect

将本项目根目录的 `cc-connect.config.toml` 复制到 cc-connect 配置目录：

```bash
mkdir -p ~/.cc-connect
cp cc-connect.config.toml ~/.cc-connect/config.toml
```

现在 Web 端 `Settings -> 会话平台` 已经支持三件事：

1. 检查本机是否安装 `cc-connect`
2. 自动修复默认 `work_dir / args / [management]`
3. 启动 / 停止本地 `cc-connect`

如果你习惯手动配置，也可以继续编辑 `~/.cc-connect/config.toml`，核心字段如下：

```toml
[projects.agent.options]
work_dir = "/your/default/workspace"                                    # ← 默认工作区路径
command = "npx"
args = ["tsx", "/path/to/Antigravity-Mobility-CLI/scripts/antigravity-acp.ts"]  # ← 修改为你的实际路径
display_name = "Antigravity Agent"
```

微信平台配置（`token` 等）已由步骤 2 自动填入：
```toml
[projects.platforms.options]
token = "自动填入"
base_url = "自动填入"
account_id = "自动填入"
allow_from = "*"    # "*" = 任何人可用；替换为你的微信 ID 限制访问
```

Settings 页依赖 `management` 配置来检测和控制本地进程：

```toml
[management]
enabled = true
port = 9820
token = "ag-mgmt-2026"
cors_origins = ["http://localhost:3000"]
```

---

## 步骤 4：启动服务

需要同时运行两个进程：

**终端 1 — Antigravity Gateway：**
```bash
cd /path/to/Antigravity-Mobility-CLI
npm run dev
```

**终端 2 — cc-connect：**
```bash
cc-connect
```

如果你已经完成了步骤 2 和步骤 3，也可以直接在 `Settings -> 会话平台` 点击 `启动 cc-connect`，不必再回终端手动拉起。

---

## 步骤 5：开始使用

在微信中向绑定的微信客服号发送消息即可。

### 命令

命令分为两类：**ACP 适配器处理**（Antigravity 专属功能）和 **cc-connect 内置**（会话管理）。

#### Antigravity 专属命令（ACP 适配器拦截处理）

这些命令通过**中文关键词**触达适配器（cc-connect 的内置同名斜杠命令会被 cc-connect 自身拦截）：

| 触发方式 | 功能 | 示例 |
|---------|------|------|
| `模型` | 查看可用模型 + 配额 | 直接发"模型" |
| `模型 <名称或编号>` | 切换 AI 模型 | `模型 1` 或 `模型 gemini` |
| `ws` 或 `工作区` | 查看/切换工作目录 | `ws` 查看列表，`ws 2` 切换 |
| `状态` | 系统状态 + 配额信息 | |
| `帮助` | 命令列表 | |
| `workflow` 或 `流程` | 列出可用工作流 | |
| `skill` 或 `技能` | 列出可用技能 | |

#### cc-connect 内置命令

| 命令 | 功能 |
|------|------|
| `/new` | 新建对话 |
| `/list` | 列出历史对话 |
| `/switch <n>` | 切换到第 n 个对话 |

> **注意**：cc-connect 也内置了 `/model`、`/workspace`、`/status`、`/help` 斜杠命令，但这些会被 cc-connect 拦截而不会到达 Antigravity 适配器。要使用 Antigravity 的版本，请用中文关键词（`模型`、`工作区`、`状态`、`帮助`）。

### 工作区选择

首次发消息时，ACP 适配器会自动检测可用工作区。你可以通过以下方式指定：

1. **配置文件** — 在 `config.toml` 中设置 `work_dir`
2. **运行时选择** — 发送 `/workspace` 或 `ws` 查看菜单并选择
3. **自动检测** — 如果只有一个工作区，自动使用
4. **Playground 回退** — 无匹配工作区时使用 Playground 模式

---

## 源码编译 cc-connect（ANP 支持）

如果需要 ANP 协议支持，需从源码编译：

```bash
# 克隆源码
git clone https://github.com/chenhg5/cc-connect.git
cd cc-connect

# 编译（包含 ANP 支持）
go build -tags anp -o cc-connect .

# 安装到 PATH
mv cc-connect /usr/local/bin/
# 或
go install -tags anp .
```

---

## 故障排查

### cc-connect 启动后收不到消息

1. 确认 Antigravity Gateway 正在运行（`http://localhost:3000`）
2. 确认 `config.toml` 中的 `args` 路径指向正确的 `antigravity-acp.ts`
3. 检查 cc-connect 日志：`cc-connect --log-level debug`
4. 打开 `Settings -> 会话平台`，确认页面显示：
   - 安装 = 已安装
   - 配置 = 已就绪
   - 绑定 = 已完成 weixin setup
   - 运行 = 运行中

### 消息发送后无回复

1. 确认 Antigravity 桌面应用已启动并登录
2. 检查 Gateway 是否发现了 Language Server：`curl http://localhost:3000/api/servers`
3. 确认工作区已注册：`curl http://localhost:3000/api/workspaces`

### 模型切换不生效

模型偏好持久化在 `~/.cc-connect/antigravity/model`。如需重置：
```bash
rm ~/.cc-connect/antigravity/model
```

### 手动测试 ACP 适配器

```bash
echo '{"jsonrpc":"2.0","method":"session/new","id":1,"params":{"cwd":"/your/project"}}' | \
  npx tsx scripts/antigravity-acp.ts
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AG_BASE_URL` | `http://127.0.0.1:3000` | Gateway 地址 |
| `AG_GATEWAY_HOME` | `~/.gemini/antigravity/gateway` | 全局数据目录 |

---

## 安全提示

- `allow_from = "*"` 表示任何微信用户都可以调用你的 Agent。建议在生产环境中替换为你自己的微信 ID
- 微信 token 存储在 `~/.cc-connect/config.toml` 中，注意保护此文件权限
- ACP 适配器与 Gateway 之间通过 localhost 通信，无需额外加密

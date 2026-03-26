# Obsidian × Antigravity Gateway 设置指南

> 在 Obsidian 侧边栏中直接使用 Antigravity AI Agent 对话。

---

## 系统架构

```
Obsidian Vault → 插件 (api-client.ts) → Gateway REST + WebSocket → Language Server
```

插件通过 HTTP REST 管理对话，通过 WebSocket 接收实时流式响应。

---

## 前置条件

- [Obsidian](https://obsidian.md/) ≥ 1.0
- Antigravity 桌面应用已安装并已登录
- Antigravity Gateway 已启动（`npm run dev`）

---

## 步骤 1：安装插件

仓库已提供打包好的插件包 `plugins/obsidian-antigravity.zip`。

1. 解压 `obsidian-antigravity.zip`，得到一个包含 `main.js`、`manifest.json`、`styles.css` 的文件夹
2. 打开 Obsidian → **Settings** → **Community plugins** → 点击插件列表旁边的 📁 文件夹图标（**Open plugins folder**）
3. 将解压后的文件夹整个拖入打开的目录中，确保文件夹名为 `obsidian-antigravity`
4. 回到 Obsidian，刷新插件列表或重启 Obsidian

> **开发者**：如需修改源码后重新编译，见下方"开发调试"章节。

---

## 步骤 2：启用插件

1. 打开 Obsidian → **Settings** → **Community plugins**
2. 如果未开启，点击 **Turn on community plugins**
3. 在列表中找到 **Google Antigravity Obsidian**，启用开关
4. 右侧边栏会自动出现聊天面板（也可点击左侧 Ribbon 的机器人图标打开）

---

## 步骤 3：配置

打开 **Settings** → **Google Antigravity Obsidian**：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| **Gateway URL** | `http://localhost:3000` | Gateway 服务地址。远程访问时改为实际 IP 或隧道地址 |
| **Workspace** | Auto-detect from vault path | 关联的工作区。如果 Vault 路径与某个 Antigravity 工作区匹配，会自动检测 |

### Workspace 自动检测

插件启动时会调用 Gateway 获取所有工作区列表，并尝试用 Vault 路径匹配。如果你的 Vault 目录正好是一个 Antigravity 项目目录，会自动关联。否则需要手动在下拉菜单中选择。

---

## 使用

### 基本对话

1. 在右侧边栏的聊天面板中输入消息
2. 按 Enter 发送（Shift+Enter 换行）
3. AI 回复会实时流式显示

### 对话管理

- 点击 **New Chat** 创建新对话
- 对话历史会保留，可在列表中切换

### 模型选择

在聊天面板顶部可以切换 AI 模型。可用模型来自 Gateway 的 `/api/models` 接口。

### 命令面板

按 `Cmd+P`（macOS）打开命令面板，搜索 **Antigravity** 可找到：

| 命令 | 说明 |
|------|------|
| Open Google Antigravity Chat | 打开/聚焦聊天侧边栏 |

---

## 远程访问

如果 Gateway 运行在另一台机器上（或通过 Cloudflare Tunnel 暴露），只需修改 Gateway URL 设置即可。

```
# 局域网
http://192.168.1.100:3000

# Cloudflare Tunnel
https://your-tunnel.trycloudflare.com
```

> Gateway 已配置 CORS，允许来自 Obsidian 插件的跨域请求。

---

## 故障排查

### 聊天面板不显示

1. 确认插件已启用（Settings → Community plugins）
2. 点击左侧 Ribbon 栏的机器人图标
3. 或通过命令面板搜索 "Open Google Antigravity Chat"

### 发送消息后无回复

1. 确认 Gateway 正在运行：`curl http://localhost:3000/api/servers`
2. 确认 Antigravity 桌面应用已启动并登录
3. 检查 Obsidian 开发者控制台（`Cmd+Option+I`）中的错误日志

### Workspace 选择无选项

Gateway 未发现任何 Language Server。确认：
1. Antigravity 桌面应用已打开至少一个 workspace
2. Gateway 能发现 Server：`curl http://localhost:3000/api/servers`

### WebSocket 断连

插件内置了自动重连机制（3 秒后重试）。如果持续断连，检查 Gateway 是否仍在运行。

---

## 开发调试

如需修改插件源码，安装依赖后重新编译：

```bash
cd plugins/obsidian-antigravity
npm install
npm run dev        # 编译并生成 sourcemap
```

修改代码后重新运行 `npm run dev`，然后在 Obsidian 中 **Reload app without saving**（`Cmd+R`）即可看到变更。

Obsidian 开发者控制台（`Cmd+Option+I`）可查看 `[Google Antigravity Obsidian]` 前缀的日志。

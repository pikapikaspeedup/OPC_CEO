# 平台工程部 Codex CLI Worktree 执行评估

**日期**: 2026-05-01
**状态**: V1 runner 已落地并验证
**边界**: 本文评估并记录平台工程部调用 Codex CLI 修改主软件的执行模型；当前不包含自动 merge / push / deploy。

## 1. 结论

平台工程部作为内置部门，应继续拥有独立 workspace；但它修改主软件时，不应在部门 workspace 里直接改代码，也不应把代码文件零散复制进去。

正确模型是：

```text
平台工程部 workspace
-> 创建一次受控执行任务
-> 从目标仓库生成一致执行基线
-> 基于该基线创建 git worktree
-> Codex CLI 在 worktree 内执行
-> 系统收集 diff / scope / validation evidence
-> 人类准出后再决定 merge
```

V1 runner 已把关键问题收敛成“执行基线 + worktree 隔离 + evidence”的固定合同。

2026-05-01 已补上 V1 执行脚手架：

- `src/lib/platform-engineering-codex-runner.ts`
- `src/lib/bridge/codex-adapter.ts` 的 `codex exec --cd <worktreePath> --sandbox workspace-write`
- `$AG_GATEWAY_HOME/system-workspaces/platform-engineering/worktrees/`
- `$AG_GATEWAY_HOME/system-workspaces/platform-engineering/evidence/codex-runs/`

## 2. 当前事实

平台工程部 workspace 是系统部门自己的工作区，位置类似：

```text
$AG_GATEWAY_HOME/system-workspaces/platform-engineering/
```

它应该保存：

- 部门配置
- 部门记忆
- proposal / project / run 状态
- task packet
- evidence bundle
- worktree 管理记录

主软件仓库仍然是：

```text
/Users/darrel/Documents/Antigravity-Mobility-CLI
```

Codex CLI 执行时的工作目录应该是从这个仓库创建出的 git worktree。这个 worktree 顶层必须像完整仓库一样包含：

- `src/`
- `package.json`
- `AGENTS.md`
- `docs/`
- `User Story/`
- `Tool_Guide/`

因此，repo 内的 `AGENTS.md` 被 Codex CLI 读取是正确行为，不是污染。它是目标仓库的开发约束。平台工程部自己的记忆和规则不应覆盖 repo 的 `AGENTS.md`，只应参与生成很小的 task packet。

## 3. V1 runner 吸收的执行断点

### 3.1 文件 seed 不是稳定执行基线

曾尝试把当前工作树中的目标文件和部分依赖文件复制到 worktree。

这个做法不可靠：

- 复制少了，`tsc` / import graph 会断。
- 复制多了，worktree 里会出现大量背景 dirty files。
- evidence 难以区分哪些是原本未提交状态，哪些是 Codex CLI 本轮新增改动。

结论：文件 seed 只能作为补充能力，不能作为主执行路径。

### 3.2 主仓库可能存在未提交状态

主仓库不一定是干净工作树。
如果直接从 `HEAD` 创建 worktree，Codex CLI 看不到当前未提交实现。
如果把未提交内容全量复制过去，evidence 会被背景改动污染。

这会导致两种错误：

- Codex CLI 基于过期代码工作。
- 系统把已有脏文件误判成本轮 Codex 修改。

因此，平台工程部执行代码任务前必须先明确“本次执行基线”。

### 3.3 `Codex CLI exit 0` 不等于任务成功

试跑中出现过 Codex CLI 退出成功，但没有产生任何文件改动的情况。

对代码修改任务来说，这不能算通过。
执行层必须把以下情况视为失败：

- Codex CLI 非零退出
- 期望改代码但 `changedFiles = []`
- 改动超出允许范围
- `git diff --check` 失败
- 指定验证命令失败

### 3.4 worktree 需要依赖策略

git worktree 不会带 `node_modules`。
如果在 worktree 内直接跑 `eslint` / `tsc`，依赖解析可能失败。

V1 可以接受的本地策略是：

- 如果主仓库已有 `node_modules`，在 worktree 中创建 `node_modules` symlink。
- evidence 中忽略这个 symlink。
- 如果没有依赖目录，则先失败并提示需要安装依赖，不要静默跳过验证。

CI 级策略可以以后再升级为 worktree 内独立 `npm ci`。

## 4. 不应采用的路径

### 4.1 不应让平台工程部直接改主仓库

原因：

- 无法隔离失败改动。
- 无法做准出前证据包。
- 会和用户正在进行的工作互相覆盖。

### 4.2 不应把 Codex CLI 做成 Provider

Codex CLI 是被调用的高权限执行工具，不是模型 provider。

模型 provider 只负责 LLM 接入；Codex CLI 负责在 worktree 中读代码、改代码、跑命令。

### 4.3 不应给 Codex CLI 传超长上下文

Codex CLI 自己会读取仓库、搜索文件并遵守 `AGENTS.md`。
系统只应传很小的 task packet：

- 目标
- 背景
- 允许修改范围
- 禁止行为
- 入口文件
- 验证命令

大文档、大段架构内容和完整用户故事不应直接塞进 prompt。

## 5. V1 执行基线

V1 固定支持两种执行基线。

### 5.1 Clean checkpoint base

适用场景：主仓库可以先提交一个明确 checkpoint。

流程：

```text
确认 checkpoint commit
-> 从 commit 创建 worktree branch
-> Codex CLI 修改
-> 验证
-> evidence
```

优点：

- 最简单
- evidence 最干净
- merge 语义最清楚

限制：

- 要求执行前先把需要进入基线的改动提交。

### 5.2 Temporary snapshot base

适用场景：当前工作树包含尚未提交但必须参与执行的状态。

流程：

```text
用临时 git index 捕获当前工作树
-> 生成 dangling snapshot commit
-> 从 snapshot commit 创建 worktree branch
-> Codex CLI 修改
-> evidence 只比较 snapshot 之后的改动
```

注意：

- 不能污染主仓库 index。
- 不能自动 merge snapshot。
- snapshot 只是执行基线，不是产品提交。
- 需要记录 snapshot SHA，方便追踪。

这条路径比文件 seed 更稳，但要谨慎处理未跟踪的大文件和敏感文件。

## 6. V1 执行合同

平台工程部调用 Codex CLI 时，V1 固定以下合同。

### 输入

- `targetRepoPath`
- `baseMode`: `checkpoint` 或 `snapshot`
- `taskKey`
- `goal`
- `allowedPathPrefixes`
- `entryFiles`
- `validationCommands`
- `expectEdits`

runner 会把这些字段压缩成一个小 task packet 传给 Codex CLI。Codex CLI 仍然自己读取仓库和 `AGENTS.md`，系统不把大段架构文档、完整用户故事或长期记忆直接塞进 prompt。

### Codex CLI 调用

使用：

```bash
codex exec --cd <worktreePath> --sandbox workspace-write "<small task packet>"
```

不使用：

- `--full-auto`
- 大上下文 prompt
- 主仓库根目录作为写入目录

### 成功条件

必须全部满足：

- Codex CLI 退出成功
- 如果 `expectEdits = true`，必须存在新增改动
- `changedFiles` 全部落在 allowlist 内
- `git diff --check` 通过
- 指定验证命令通过
- evidence bundle 写入平台工程部 workspace

### 失败条件

任一条件失败，任务进入 `blocked` 或 `needs-retry`，不进入准出：

- worktree 创建失败
- Codex CLI 无改动
- Codex CLI 改出范围
- 验证命令失败
- worktree 依赖不可用
- evidence 无法生成

### 当前实现

当前 V1 runner 已具备：

- 每次运行创建独立 worktree 和独立 `ai/platform-*` 分支，避免复跑污染旧工作区。
- `checkpoint` 基线：从指定 ref 或 `HEAD` 创建 worktree。
- `snapshot` 基线：使用临时 git index 捕获当前未提交工作树，生成 snapshot commit，不污染主仓库 index。
- 运行前捕获 baseline snapshot，运行后只把 Codex CLI 本轮新增变化计入 `changedFiles`。
- 事前把 allowlist、预期改动、验证命令写入小 task packet。
- 事后检查 `expectEdits`、allowlist、`git diff --check` 和调用方传入的验证命令。
- 若主仓库已有 `node_modules`，在 worktree 内创建 symlink，避免每个副本重复安装依赖。
- evidence JSON 写入平台工程部 workspace 的 `evidence/codex-runs/`。
- Codex adapter 会跳过 PATH 中旧的本地 `codex` 包，优先选择输出形如 `codex-cli x.y.z` 的成熟 Codex CLI；必要时可用 `CODEX_CLI_PATH` 显式指定。

## 7. 当前边界

runner 已收敛为五件事：

1. 创建一致基线
2. 创建 worktree
3. 调 Codex CLI
4. 收集 diff / scope / validation
5. 输出 evidence

workflow、proposal、approval 逻辑不塞进 runner，仍由 Project / Company Kernel / Approval 主线负责。

当前边界：

- `checkpoint` 是默认基线；调用方需要纳入未提交状态时显式传 `baseMode = snapshot`。
- `snapshot` 只作为执行基线，不是产品提交，也不能被自动 merge。
- 文件 seed 不是主执行路径，只能作为补充能力。
- runner 不做自动 merge / push / deploy。
- evidence 只解释基线之后的本轮新增变化。
- 人类准出仍是进入 merge/release 的前置条件。

## 8. 当前判断

平台工程部独立 workspace 的方向是对的。
Codex CLI 作为执行工具的方向也是对的。
V1 runner 当前已经固化执行层的基线和证据合同。

一句话：

> Codex CLI 必须在一致基线生成的 worktree 中工作，并由 runner 记录改了什么、是否越界、是否验证通过；准出和合并不属于 runner。

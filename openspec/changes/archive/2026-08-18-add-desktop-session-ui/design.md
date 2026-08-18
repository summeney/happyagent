## Context

现状与约束见 [proposal.md](./proposal.md) 的 Why。关键技术事实：

- agent 运行时是 LangGraph.js 的 `StateGraph`，`buildGraph({ checkpointer, model })` 返回编译后的图（`src/graph.ts`）。工具含 `run_bash`，必须在 Node 环境执行。
- 现有流式打印走 `app.stream(input, { streamMode: "updates" })`，逐节点产出 AI 消息 / 工具消息（`src/cli.ts` 的 `printUpdate`）。
- HITL 依赖 checkpointer：`run_bash` 前 `interrupt`，外层用 `new Command({ resume: { approved } })` 恢复。
- LangGraph 嵌入式 checkpointer 的所有读取 API（`get` / `list` / `getStateHistory`）都要求已知 `thread_id`，**没有**"列出全部 thread"的能力；该能力只在需单独部署的 LangGraph Platform 层才有。

## Goals / Non-Goals

**Goals:**
- 复用现有 `buildGraph` 与工具，不改 agent 循环本身；桌面化只在其外围加壳。
- 主进程直接跑图，避免额外的 HTTP 服务、端口与 CORS。
- 会话历史与目录持久化到单个本地 SQLite 文件，跨重启保留。

**Non-Goals:**
- 不做多会话并发运行（同一时刻仅一个会话在生成回复）。
- 不接入 LangGraph Platform / Server（Tier 2）。
- 不做会话重命名 / 删除 / 搜索（可后续增量）；本次仅新建 / 列出 / 切换。
- 不做打包分发（图标 / 签名 / 自动更新），仅保证本机可 `dev` 启动。

## Decisions

### D1 · 桌面技术选 Electron（而非本地 web / Tauri）

Electron 主进程本身就是 Node 进程，`buildGraph()`、SqliteSaver、工具可**直接在主进程内调用**，无需把 fs/bash 暴露成网络 API。Tauri 核心是 Rust，Node agent 仍要单独起进程再跨 IPC，对纯 JS 项目反而多一层；本地 web + 浏览器需自行搭 server 层且非独立窗口。与 VS Code / Cursor / Claude 桌面版同源，生态成熟。

### D2 · 进程与通信分层

```
Electron 主进程 (Node)                     渲染进程 (UI)
┌───────────────────────────────┐        ┌──────────────────────┐
│ buildGraph()  ← 唯一实现       │        │ session 列表 / 聊天区 │
│ SqliteSaver   ← 跨重启持久化   │◀─IPC──▶│ 常驻输入框 / 审批弹窗 │
│ sessions 目录表               │  事件流 │                      │
│ 会话服务 / 流式转发 / HITL     │        │                      │
│ tools: fs / run_bash          │        │                      │
└───────────────────────────────┘        └──────────────────────┘
        preload 暴露受限 IPC 桥（contextIsolation 开）
```

渲染进程不直接碰 Node；经 `preload` 暴露一组受限的 `invoke`（请求-响应）与 `on`（事件订阅）API。安全默认：`contextIsolation: true`、`nodeIntegration: false`。

### D3 · IPC 事件协议（请求-响应 + 单向事件流）

- **请求-响应**（渲染 → 主，`ipcRenderer.invoke`）：`sessions:list`、`sessions:create`、`sessions:history(threadId)`、`chat:send(threadId, text)`、`approval:resolve(runId, approved)`。
- **单向事件流**（主 → 渲染，`webContents.send`，按 `threadId` + `runId` 标记）：把 `stream(streamMode:"updates")` 的每个 chunk 归一化为事件 —— `run:ai`（文本）、`run:tool_call`（名称+参数）、`run:tool_result`、`run:interrupt`（待审批命令）、`run:done`、`run:error`。

这样 `printUpdate` 的分类逻辑（ai / tool_call / tool_result）从"打印"改为"发事件"即可复用。

### D4 · node:sqlite 持久化（自写 checkpointer）+ 自建 sessions 表,同一文件

**决策更新（实现期）**：不用 LangGraph 官方 `@langchain/langgraph-checkpoint-sqlite`。它底层是原生模块 better-sqlite3，在 Electron 里必须用 electron-rebuild 把二进制重编到 Electron 的 Node ABI，每次升级 Electron 都要重来——而实测 Electron 43 的 V8 头文件直接让 better-sqlite3（11.x/13.x）编译失败（14 个错误）。这正是原风险 R2 的兑现，且属长期维护雷。

改用运行时**内置的 `node:sqlite`**（Node 22.5+ / Electron 内置 Node 均带），零原生编译、零 ABI 匹配、随运行时升级永不失配。持久 checkpointer 由 `src/session/node-sqlite-saver.ts` 手写：忠实照搬官方 SqliteSaver 的表结构（`checkpoints` / `writes`）、序列化（复用 `BaseCheckpointSaver` 的 serde）与查询逻辑，仅把 better-sqlite3 API 换成 node:sqlite（手动 BEGIN/COMMIT 事务、绑定参数 undefined→null）。`buildGraph({ checkpointer })` 一行不改。手写 checkpointer 也正合本仓库"拆开原语理解 LangGraph"的初衷。

> Electron 43 内置 Node 22.x 下 `require('node:sqlite')` 需 `--experimental-sqlite`，故 `desktop` 脚本以 `NODE_OPTIONS=--experimental-sqlite` 启动主进程（系统 Node 24 无需 flag，本环境已验证）。

补齐"列出全部会话"缺口：在**同一个 .db** 里自建 `sessions(id TEXT PK, title TEXT, created_at, updated_at)` 表（同样用 node:sqlite）。checkpointer 管会话"内容"，该表管会话"目录 + 门牌"。切换 = 读该表得列表 → 用户点某行 → 用其 `thread_id` 向 checkpointer 取历史。

### D5 · 标题与更新时间

首条用户消息截断为标题（不额外调模型，省一次调用与延迟）。每轮交互结束刷新 `updated_at`，列表按其倒序。

### D6 · HITL 在 UI 的 interrupt/resume 时序

沿用现有机制，仅把审批 IO 从 readline 换成 IPC：

```
主: stream 命中 interrupt → 发 run:interrupt(runId, command)
渲染: 弹窗 → 用户点批准/拒绝 → invoke approval:resolve(runId, approved)
主: new Command({ resume: { approved } }) 恢复同一 stream 循环 → 继续发事件
```

审批做成全局开关（设置项），默认关；开启时对所有会话的 `run_bash` 生效。

### D7 · 并发策略

同一时刻仅允许一个会话处于"生成中"。渲染层在 `run:done`/`run:error` 前禁用该会话的输入（对应 desktop-ui 规格的"运行中禁止重复提交"）。切到其他会话仅查看历史，不并行发起新 run。

## Risks / Trade-offs

- [引入 Electron 使"学习玩具"依赖显著变重] → 桌面壳与 agent 核心解耦，`src/graph.ts` 及工具保持可被 CLI 独立驱动；README 说明桌面为可选形态。
- [~~better-sqlite3 类原生模块需与 Electron 的 Node ABI 匹配~~ **已在实现期兑现并根除**] → 实测 Electron 43 下 better-sqlite3 编译失败；已改用运行时内置 `node:sqlite` + 自写 checkpointer（见 D4），**彻底移除原生模块**，无 electron-rebuild、随 Electron 升级不再失配。残留风险仅：node:sqlite 目前仍标记 experimental（API 可能微调）、Electron 43/Node 22 需 `--experimental-sqlite` flag（已在 `desktop` 脚本注入）。
- [自建 sessions 表与 checkpointer 数据可能不一致（如新建了会话却从未发消息，checkpointer 无记录）] → 以 sessions 表为会话存在性的唯一真源；空会话允许存在，切入时 history 为空即可。
- [单会话串行，长任务会阻塞用户切去别处发起新任务] → 本次接受该限制（Non-Goal），切换查看历史不受影响。

## Migration Plan

1. 删除 `src/agent.ts`、`docs/notes-phase2.md`；`src/cli.ts` 移除 `--graph` / `buildAgent`，`src/tools/index.ts` 及注释去 Phase 措辞。
2. 新增依赖与 `data/*.db` 的 `.gitignore` 忽略。
3. 增量搭桌面壳：主进程会话服务 + SqliteSaver → preload 桥 → 渲染 UI（列表/聊天/输入/审批）。
4. 回滚：桌面相关为纯新增文件与依赖，删除新增文件并还原 `cli.ts`/`README` 即可回到简化后的 CLI；agent 分支的移除通过 git 还原。

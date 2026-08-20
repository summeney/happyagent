# happyagent

一个**个人全能工作 agent**：Electron 桌面应用 + 本地嵌入式 [LangGraph](https://github.com/langchain-ai/langgraphjs) Server 运行时，由 **Kimi K2.6**（Moonshot）驱动。支持并发多会话、长线任务、MCP 接入，会话历史跨重启持久化。

> ⚠️ 仅本机个人使用、默认全权限。`run_bash` 能执行任意命令且不设审批——如需限制，请在操作系统层面（受限用户 / 沙箱）约束运行环境。

## 架构

agent 本体是一个**带工具的 ReAct 循环**（手写 `StateGraph`，模型节点 ↔ 工具节点）。运行时不再由 CLI/主进程手写编排，而是交给 LangGraph 的**嵌入式 server**（`createEmbedServer`）——它在一个 utilityProcess 里进程内起服务，原生提供并发、后台运行、取消、thread 管理；持久化与线程目录由我们注入的落盘实现承载。

```
┌─ Electron App ───────────────────────────────────────────────┐
│  main（监工）                                                 │
│   · fork utilityProcess 起运行时、崩溃退避重启、退出清理      │
│                         │                                     │
│                         ▼ utilityProcess                      │
│   ┌──────────────────────────────────────┐                   │
│   │ createEmbedServer（进程内，无 CLI/Docker）│                │
│   │  · graph = buildGraph()（ReAct，Kimi） │                  │
│   │  · 注入 checkpointer（node:sqlite 落盘） │  ──▶ 外部 MCP   │
│   │  · 注入 ThreadSaver（会话目录）         │      servers    │
│   │  · MCP 工具合并 · Langfuse tracing      │                 │
│   └──────────────────────────────────────┘                   │
│                         ▲ HTTP/SSE (127.0.0.1)                │
│  renderer（Vue 3）───────┘                                    │
│   · @langchain/langgraph-sdk 直连 · 会话列表 / 流式对话       │
└──────────────────────────────────────────────────────────────┘
```

模型经 OpenAI 兼容协议接入——`ChatOpenAI` 只改 `baseURL` 即从"调 OpenAI"变为"调 Kimi"（`src/core/model.ts`，注意 Kimi 只接受 `temperature=1`）。

## 目录结构

三进程约定 + 内核/外壳分层：

```
happyagent/
├── langgraph.json          # 供 langgraphjs dev 注册 graph（开发调试用）
├── vite.config.ts          # 渲染层 Vite 构建
├── src/
│   ├── core/               # 【内核】agent 本体，不知道 Electron/HTTP
│   │   ├── graph.ts        #   手写 StateGraph（可注入替身模型）
│   │   ├── model.ts        #   Kimi 接入（ChatOpenAI + baseURL，temperature=1）
│   │   ├── prompt.ts       #   系统提示词
│   │   ├── workspace.ts    #   工作区根（HAPPYAGENT_WORKDIR）解析相对路径
│   │   ├── tools/          #   read_file / list_dir / write_file / run_bash / grep / edit_file
│   │   ├── mcp/            #   MCP 接入（@langchain/mcp-adapters）
│   │   ├── tracing.ts      #   Langfuse tracing（no-op 优雅降级）
│   │   └── session/        #   node:sqlite checkpointer（注入 embed server）
│   ├── app/                # 【外壳·Electron】
│   │   ├── main/           #   监工：起/守护 utilityProcess、窗口
│   │   ├── preload/        #   原生桥（runtime 状态/url）
│   │   └── server/         #   嵌入式运行时（createEmbedServer）+ 线程目录 + utilityProcess 入口
│   ├── renderer/           # 【外壳·UI】Vue 3 应用（SDK 直连 server）
│   └── shared/             # 跨层类型
├── test/                   # unit / integration / e2e / contract
└── openspec/               # 需求/设计/任务（规划）
```

## 快速开始

```bash
git submodule update --init --recursive   # 拉取 langgraphjs 参考资料（可选）
npm install
cp .env.example .env                        # 填入 MOONSHOT_API_KEY=sk-...
```

密钥获取：<https://platform.moonshot.cn/>。`.env` 已被忽略，不会提交。

### 启动桌面应用

```bash
npm run desktop
```

> `desktop` 脚本以 `NODE_OPTIONS=--experimental-sqlite` 启动（内置 Node 需此 flag 用 `node:sqlite`）。

- 左侧 `＋` 新建会话、点击切换；切换后聊天区显示该会话历史。
- 底部输入框：Enter 发送、Shift+Enter 换行；同一会话生成期间禁止重复提交，**其他会话可同时运行**。
- 生成中可点「停止」取消当前会话（不影响并发的其他会话）。
- 可选 `HAPPYAGENT_MODEL` 指定模型名（默认 `kimi-k2.6`）、`HAPPYAGENT_WORKDIR` 指定工具的工作区根目录。

## MCP 接入

把外部 MCP server 的工具并入 agent：在应用数据目录放一个 `mcp.json`（或用 `HAPPYAGENT_MCP_CONFIG` 指向任意路径），格式见 [`mcp.example.json`](mcp.example.json)：

```json
{ "mcpServers": { "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] } } }
```

未配置、配置错误或某个 server 连不上时，agent 以内置工具正常运行（优雅降级）。

## 观测 · Langfuse tracing

配置 Langfuse 密钥后，每次运行会被结构化记录（每次 LLM 调用与工具调用嵌套）。自托管：

```bash
docker compose up -d                        # 起本地 Langfuse（需 Docker）
# 在 http://localhost:3000 建项目取密钥，填进 .env：
#   LANGFUSE_PUBLIC_KEY=pk-lf-...  LANGFUSE_SECRET_KEY=sk-lf-...  LANGFUSE_BASE_URL=http://localhost:3000
```

没配密钥完全不影响使用——tracing 静默变 no-op，agent 照常离线跑。

## 测试

```bash
npm test            # 单元 + 集成（Vitest，注入替身模型，不发真实网络）
npm run test:e2e    # Playwright 驱动真 Electron：新建→发消息→流式、跨重启持久化
npm run test:contract  # Kimi function-calling 契约（真实网络，缺 key 自动跳过）
npm run typecheck   # TypeScript 类型检查（含 test）
```

## 开发调试

```bash
npm run dev:server  # 单独起 langgraphjs dev（LangGraph Studio UI，调试 graph）
npm run build:electron  # 打包 main/preload/runtime + Vite 构建 renderer
```

`vendor/langgraphjs` 为参考资料（submodule），不进构建/分发。

# happyagent

一个基于 [LangGraph.js](https://github.com/langchain-ai/langgraphjs) 构建、由 **Kimi K2.6**（Moonshot）驱动的命令行 **coding agent**。纯学习/研究用途：通过亲手搭一个"能读代码、改代码、跑命令"的 agent，来理解 LangGraph 的核心原语。

> ⚠️ 这是学习玩具，不是生产工具。`run_bash` 能执行任意命令，请在受控目录里玩，或用 `--hitl` 打开人工审批。

## 它是什么

一个 coding agent 本质就是**带工具的 ReAct 循环**：

```
        ┌──────────┐  有 tool_calls?   ┌──────────┐
   START│  LLM 节点 │───────是────────▶│ 工具节点  │──┐
      └▶│ (Kimi)   │                  └──────────┘  │
        └──────────┘◀───────────────────────────────┘
              │ 否（模型说完了）
              ▼ END
```

模型通过 OpenAI 兼容协议接入——`ChatOpenAI` 只改一个 `baseURL` 就从"调 OpenAI"变成"调 Kimi"（见 `src/model.ts`）。

## 目录结构

```
happyagent/
├── vendor/langgraphjs/     # git submodule：langgraphjs 整个 monorepo，只当学习资料（examples/、libs/）
├── src/
│   ├── model.ts            # Kimi 接入（ChatOpenAI + baseURL）
│   ├── prompt.ts           # 系统提示词
│   ├── tools/              # 工具集：read_file / list_dir / write_file / run_bash / grep / edit_file
│   ├── agent.ts            # Phase 1：createReactAgent 预制版
│   ├── graph.ts            # Phase 2：手写 StateGraph 复刻版
│   ├── smoke.ts            # Phase 0：冒烟测试
│   └── cli.ts              # 命令行入口
├── docs/notes-phase2.md    # 预制版 vs 手写版逐原语对照笔记
└── openspec/               # 需求/设计/任务（本项目的规划）
```

## 快速开始

### 1. 拉取 submodule

克隆本仓库后（或初次使用时）拉取 langgraphjs 学习资料：

```bash
git submodule update --init --recursive
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置密钥

复制 `.env.example` 为 `.env`，填入你的 Moonshot 密钥（获取地址：<https://platform.moonshot.cn/>）：

```bash
cp .env.example .env
# 然后编辑 .env，填入 MOONSHOT_API_KEY=sk-...
```

`.env` 已被 `.gitignore` 忽略，不会提交。

## 四个学习阶段（Phase 0 → 3）

### Phase 0 · 冒烟测试

先验证 Kimi 经由 LangChain 能返回规范的 `tool_calls`（整套方案唯一的真实未知数）：

```bash
npm run smoke
```

看到 `✅ 冒烟测试通过` 并打印出 tool_calls 即可继续。

### Phase 1 · 先跑起来（预制版）

用 `createReactAgent` + 工具集直接跑一个能用的 coding agent：

```bash
npm run agent -- "读取 package.json，告诉我依赖了哪些包"
npm run agent -- "在 src 目录里找出所有用到 interrupt 的地方"
```

### Phase 2 · 回头拆（手写版）

用手写 `StateGraph` 复刻同一个 agent，加 `--graph` 切换，两版并排对比：

```bash
npm run agent --         "统计 src 下有多少个 .ts 文件"   # 预制版
npm run agent -- --graph "统计 src 下有多少个 .ts 文件"   # 手写版
```

逐原语对照见 [docs/notes-phase2.md](docs/notes-phase2.md)。

### Phase 3 · 进阶（记忆 + 人工审批）

`--hitl` 打开危险操作审批：执行 `run_bash` 前会暂停，等你输入 `y` 才执行：

```bash
npm run agent -- --hitl "运行 npm run typecheck 看看有没有类型错误"
```

`--thread <id>` 指定会话 id（配合内存 checkpointer 支持多轮/续跑）。

## 观测 · 用 Langfuse 看交互 log

终端里的输出一闪而过、结构扁平。想把每次运行**结构化**记录下来、在 UI 里回看整条 ReAct 循环（每次 LLM 调用的完整输入/输出、工具调用的嵌套、token 用量），接入开源的 [Langfuse](https://github.com/langfuse/langfuse)（自托管）：

**1. 起本地 Langfuse**（需要 Docker）：

```bash
docker compose up -d
```

**2. 建项目取密钥**：打开 <http://localhost:3000> 注册账号 → 新建一个项目 → 在 **Settings → API Keys** 生成一对密钥。

**3. 填进 `.env`**：

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3000
```

**4. 照常跑 agent**，然后回 UI 看 trace：

```bash
npm run agent -- --thread demo "读取 package.json，告诉我依赖了哪些包"
```

启动时会打印 `🔭 Langfuse tracing 已启用`。同一 `--thread <id>` 的多次运行在 UI 里归到同一个 session。

> 没配 Langfuse 密钥也完全不影响使用——tracing 会静默变成 no-op，agent 照常离线跑。

trace 视图如何对应本项目的 ReAct 原语，见 [docs/notes-trace.md](docs/notes-trace.md)。

## 命令行开关

| 开关 | 作用 |
|---|---|
| `--graph` | 用 Phase 2 手写 StateGraph（默认用 createReactAgent） |
| `--hitl` | 执行 `run_bash` 前需人工审批 |
| `--thread <id>` | 指定会话 id（默认 `cli-session`） |
| `--model <name>` | 指定模型名（默认 `kimi-k2.6`） |

## 常用脚本

```bash
npm run smoke       # Phase 0 冒烟测试
npm run agent -- "..."   # 运行 agent
npm run typecheck   # TypeScript 类型检查
```

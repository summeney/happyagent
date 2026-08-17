## Context

happyagent 通过 LangChain 的 `ChatOpenAI`(指向 Kimi)驱动一个 ReAct 循环,两条实现路径:`agent.ts`(`createReactAgent` 预制版)与 `graph.ts`(手写 `StateGraph`)。两者都由 `cli.ts` 的 `app.stream(input, config)` 驱动。动机见 proposal.md — Why;需求见 specs/llm-tracing/spec.md。

关键约束:
- LangChain/LangGraph 的 `config.callbacks` 会自动沿 graph 向下传播到每个节点、每次 LLM 调用与每次工具调用——这是本设计得以「单点挂载、两路覆盖」的基础。
- CLI 是短命进程:任务一结束进程即退出。
- 这是学习玩具,必须能在没有任何外部服务时离线运行。

## Goals / Non-Goals

**Goals:**
- 在单一挂载点接入 tracing,不改动 `agent.ts` / `graph.ts`。
- 未配置密钥时零摩擦降级为 no-op。
- 保证短命 CLI 不丢 trace。
- 自托管 Langfuse 一条 `docker compose up` 起得来。

**Non-Goals:**
- 不做 evals、prompt 管理、成本告警等 Langfuse 的其余功能(仅用其 tracing/UI)。
- 不自建可视化界面(直接用 Langfuse 的 UI)。
- 不改动工具集、prompt 或 agent 的业务逻辑。

## Decisions

### 决策 1:用 Langfuse 官方 `@langfuse/langchain` CallbackHandler,而非自写 tracer

Langfuse 提供 `CallbackHandler`(基于 LangChain 回调协议)与 `LangfuseSpanProcessor`(基于 OpenTelemetry)。集成方式(经 context7 核实,`@langfuse/langchain` v3.x):

```
启动时注册一次 span processor：
  new NodeTracerProvider({ spanProcessors: [new LangfuseSpanProcessor()] }).register()
每次调用传入 handler：
  const handler = new CallbackHandler({ sessionId })
  app.stream(input, { ...config, callbacks: [handler] })
```

- **为什么不自写 `BaseCallbackHandler`**:自写能学 callback 原语,但要自建存储与 UI,偏离「看懂 agent 本身」的重心且工作量大。用户已确认学习重心是看懂本 agent、且可接受 Docker,现成 UI 收益最大。
- **备选**:Arize Phoenix(OTel/OpenInference)——单进程更轻,但 JS 埋点成熟度略低、UI 分组不如 Langfuse 贴合 `thread_id`;LangSmith——最丝滑但闭源上云,与「开源」诉求冲突。均舍弃。

### 决策 2:挂载点放在 `cli.ts` 的 stream config,`callbacks` 数组注入

`config.callbacks` 自动向下传播,因此在 `cli.ts` 构造 config 时注入 `callbacks: [handler]` 即可覆盖 `agent.ts` 与 `graph.ts` 两条路,满足「两路覆盖且不改各自实现」的需求。`thread_id` 直接作为 `CallbackHandler` 的 `sessionId`,实现会话分组。

### 决策 3:新增独立 `src/tracing.ts` 封装初始化与降级

- 暴露一个初始化函数:检测 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 是否存在。
  - 存在:注册 `NodeTracerProvider` + `LangfuseSpanProcessor`,返回一个能按 `sessionId` 造 handler 的工厂,以及一个 `flush()`。
  - 不存在:返回 no-op 工厂(`createHandler` 返回 `undefined`,`cli.ts` 侧 `callbacks` 变为空/不注入)与 no-op `flush()`。
- 好处:降级逻辑集中一处,`cli.ts` 只管「拿 handler、注入、退出前 flush」。降级沿用 `model.ts` 缺 key 给清晰提示的既有风格,但 tracing 缺 key 不抛错、仅静默 no-op(可打印一行提示告知 tracing 未启用)。

### 决策 4:退出前 `flush()` 并 await

`main()` 的 while 循环结束后、`main().catch` 正常/异常两条路径下,都要 `await flush()`,再让进程退出。否则 OTel 的批量导出可能还没把 span 发出去进程就结束了,导致 trace 丢失——这是 CLI 接 OTel 最常见的坑,在需求「进程退出前刷新 trace」中已固化为可测行为。

### 决策 5:自托管用官方 docker-compose

新增 `docker-compose.yml`(照 Langfuse 官方自托管配置:含 Postgres/Clickhouse/Redis/Minio 等)。`.env.example` 增加 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`(默认 `http://localhost:3000`)。密钥在 Langfuse UI 建项目后获取并填入 `.env`。

## Risks / Trade-offs

- [自托管容器较多,首次启动偏重] → 文档写清 `docker compose up -d` 与首启建项目/取密钥的步骤;强调仅在需要看 trace 时才起。
- [忘记 flush 导致偶发丢 trace] → 在 `flush()` 落地为需求场景并在文档中提示;正常与异常退出路径都覆盖。
- [Langfuse JS SDK 版本演进快,集成 API 可能变化] → 实现前以 context7 核对当版 `@langfuse/langchain` 用法;版本已在 design 中标注(v3.x)。
- [新增第三方依赖增加体积] → 属可选学习增强,不影响核心;未配置时不参与运行时行为。

## Migration Plan

- 纯新增,无破坏性变更。未配置密钥时行为与现状完全一致。
- 回滚:移除 `src/tracing.ts`、还原 `cli.ts` 的少量改动、删除新增依赖与 compose 文件即可,agent 主逻辑不受影响。

## Open Questions

- 是否需要一个 `--trace` 显式开关?当前设计采用「有 key 即启用、无 key 即 no-op」的隐式策略即可满足需求;显式开关属可延后的体验增强,不影响 specs、方案或任务拆解。

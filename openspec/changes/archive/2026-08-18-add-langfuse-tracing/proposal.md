## Why

happyagent 是一个用来「亲手搭一遍、看懂 LangGraph ReAct 循环」的学习项目,但目前它与大模型的交互只能靠 `cli.ts` 里的 `printUpdate` 打印到终端——信息一闪而过、结构扁平,看不清每次 LLM 调用的完整输入/输出、工具调用的嵌套关系、token 用量。要真正「理解和学习这个 agent」,需要一种能把整条 ReAct 循环结构化记录下来、并通过 UI 方便回看的 trace 能力。

选用开源的 **Langfuse(自托管)** 是因为:它是 MIT 协议的开源 LLM 可观测性平台,官方提供 `@langfuse/langchain` 的 CallbackHandler,与本项目的 LangChain/LangGraph 技术栈天然契合——集成只需在一处挂载 callback,`agent.ts`(预制版)和 `graph.ts`(手写版)两条路都无需改动即可被完整记录。

## What Changes

- 新增 tracing 能力:接入 Langfuse 自托管实例,把每次 agent 运行记录为一条结构化 trace(LLM 调用 + 工具调用嵌套展开,含输入/输出 message 与 token 用量)。
- 在 `cli.ts` 的 `app.stream(...)` 配置中挂载 Langfuse 的 `CallbackHandler`,并把 CLI 的 `thread_id` 映射为 trace 的 `sessionId`,使同一会话的多次运行在 UI 中归到一组。
- **优雅降级**:未配置 Langfuse 密钥时,tracing 自动变为 no-op,不影响这个学习玩具离线运行(沿用 `model.ts` 中「缺 key 给清晰提示」的既有风格)。
- **进程退出前 flush**:CLI 是短命进程,运行结束前必须刷新并等待 span 上报完成,否则 trace 会丢失。
- 新增本地自托管所需的 `docker-compose` 配置与 `.env.example` 中的 Langfuse 相关环境变量。
- 新增一份对照文档,说明 Langfuse trace 视图如何对应到本项目的 ReAct 原语(作为学习材料)。

## Capabilities

### New Capabilities
- `llm-tracing`: 把 agent 与大模型的每次交互记录为结构化 trace,并通过 Langfuse UI 查看;涵盖 callback 挂载、会话分组、优雅降级与退出前 flush 等对外可观察行为。

### Modified Capabilities
<!-- 无既有 capability 的需求发生变化。 -->

## Impact

- **代码**:新增 `src/tracing.ts`;`src/cli.ts` 少量改动(挂载 callback、退出前 flush)。`src/agent.ts`、`src/graph.ts` 不改。
- **依赖**:新增 `@langfuse/langchain`、`@langfuse/otel`、`@opentelemetry/sdk-trace-node`。
- **配置/运行**:新增 `docker-compose.yml`(本地 Langfuse);`.env.example` 增加 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`。
- **文档**:README 增加 tracing 使用说明;新增 `docs/notes-trace.md` 对照笔记。
- **无破坏性变更**:未配置密钥时行为与现状一致。

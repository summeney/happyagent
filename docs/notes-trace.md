# Tracing 笔记：Langfuse trace 视图 ↔ ReAct 原语

这份笔记说明:接入 Langfuse 后,UI 里看到的一条 **trace**,是怎么一一对应到本项目
ReAct 循环里的每个原语的。搞清这层对应,就能把「agent 内部到底发生了什么」看得明明白白。

## 一句话

一次 `npm run agent -- "..."` 运行 = Langfuse 里的**一条 trace**;
循环里每转一圈的 LLM 节点、工具节点,就是这条 trace 下**按时间嵌套的一个个 observation**。

## 挂载点:为什么只改一处就全记录了

我们只在 `src/cli.ts` 给 stream 的 config 加了一个 callback:

```ts
const handler = tracing.createHandler(opts.threadId); // Langfuse CallbackHandler
const config = { ..., callbacks: [handler] };
app.stream(input, { ...config, streamMode: "updates" });
```

关键在于 **LangChain/LangGraph 会把 `config.callbacks` 自动向下传播**——传到每个节点、
每次 LLM 调用、每个工具调用。所以:

- `src/agent.ts`(预制版 `createReactAgent`)和 `src/graph.ts`(手写 `StateGraph`)**都没改一行**,却都被完整记录。
- callback 是「旁路观察者」,不改变 agent 的任何行为;不配密钥时(`handler` 为 `undefined`)直接不注入,agent 照常跑。

底层走 OpenTelemetry:`LangfuseSpanProcessor` 把每个 span 导出到 Langfuse,`src/tracing.ts` 在启动时注册一次。

## trace 视图 ↔ 原语对照

以 `npm run agent -- "读取 package.json，告诉我依赖了哪些包"` 为例,UI 里大致长这样:

```
▼ trace: "读取 package.json…"                        ← 一次 agent 运行(cli.ts 的一次 stream)
  ▼ llmCall  (LLM: kimi-k2.6)                        ← graph.ts 的 llmCall 节点 / 预制版的 agent 节点
     input:  [system prompt] + [human: 读取…]        ← 发给模型的 messages
     output: AI → tool_calls: read_file({path:…})    ← 模型请求调工具(不是自己执行)
  ▼ tools · read_file                                ← ToolNode 执行工具
     output: { "name":"happyagent", … }              ← 结果作为 ToolMessage 回灌
  ▼ llmCall  (LLM: kimi-k2.6)                         ← 回边:结果回灌后再问一次模型
     output: AI → "依赖了 @langchain/core …"(无 tool_calls) → END
```

| trace 里看到的 | 对应的 ReAct 原语(见 notes-phase2.md) | 你能学到什么 |
|---|---|---|
| 最外层 trace | 一次 `app.stream(...)` 运行 | 一次任务从输入到结束的全过程 |
| `llmCall` observation | `llmCall` 节点 / 预制版 agent 节点 | 每一步真正发给模型的 **完整 messages** 和模型的原始返回 |
| observation 里的 `tool_calls` | 条件边 `shouldContinue` 的判断依据 | 模型是「请求」工具而非执行——数据驱动 |
| `tools · <name>` observation | `ToolNode` | 工具的真实入参与返回,以及它如何变成 `ToolMessage` |
| 同一 trace 里 llmCall 出现多次 | `tools → llmCall` 回边形成的循环 | ReAct 循环到底转了几圈、每圈上下文如何增长 |
| token 用量 / 时延 | —— | 每一步的开销,直观看到「上下文越滚越大」 |
| session 分组(按 `--thread`) | `thread_id`(checkpointer 的会话键) | 同一会话的多次运行归到一组 |

## 拿它对比预制版 vs 手写版

notes-phase2.md 说「两者对同一任务应产出等价结果」——现在你可以**用 trace 亲眼验证**:

```bash
npm run agent --         --thread cmp "统计 src 下有多少个 .ts 文件"   # 预制版
npm run agent -- --graph --thread cmp "统计 src 下有多少个 .ts 文件"   # 手写版
```

在 Langfuse 的 `cmp` session 里并排看这两条 trace:节点序列、工具调用、循环圈数应当**结构等价**。
这就把 phase2 那句「≈」从「文档断言」变成了「可观测的事实」。

## 一个必须知道的坑:退出前要 flush

CLI 是**短命进程**:任务一结束进程就退出。OTel 的 span 若还攒在缓冲里没发出去,trace 就丢了。
所以 `src/tracing.ts` 用了 `exportMode: "immediate"`,并且 `cli.ts` 在 `try/finally` 里退出前
`await tracing.flush()`——正常完成和抛异常两条路径都会 flush。这是这类工具接 CLI 最常见的丢数据原因。

## 关键收获

1. **观测是「旁路」的**:一个 callback 就把整条链路记下来,不侵入 agent 逻辑,也不改两条实现路径。
2. **trace 是 ReAct 循环的「X 光片」**:节点 = observation,回边 = 重复出现的 llmCall,条件边 = tool_calls 的有无。
3. **短命进程务必 flush**:`immediate` 导出 + 退出前 `forceFlush`,否则偶发丢 trace。
4. **可观测性让「等价」可验证**:预制版与手写版的等价,从文档断言变成了并排两条 trace 的事实。

/**
 * Tracing 层：把 agent 与大模型的每次交互记录到 Langfuse。
 *
 * 核心洞察：LangChain/LangGraph 的 `config.callbacks` 会自动沿 graph
 * 向下传播到每个节点、每次 LLM 调用、每个工具调用。所以只要在 `cli.ts`
 * 给 stream 的 config 挂一个 Langfuse `CallbackHandler`，整条 ReAct 循环
 * （predict → tool → predict …）就全被记录了——`agent.ts`（预制版）和
 * `graph.ts`（手写版）两条路都不用改。
 *
 * 底层走 OpenTelemetry：`LangfuseSpanProcessor` 负责把 span 导出到 Langfuse，
 * `NodeTracerProvider` 在进程启动时注册一次即可。
 *
 * 优雅降级：没配 Langfuse 密钥时，这里整体变成 no-op —— agent 照常离线跑，
 * 只是不产生 trace（沿用 `model.ts` 缺 key 给清晰提示的风格，但这里不抛错）。
 */
import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** tracing 句柄：给 cli.ts 用的最小接口。 */
export interface Tracing {
  /**
   * 按会话 id 造一个 callback handler，挂到 stream 的 `callbacks` 上。
   * 未启用 tracing 时返回 `undefined`（cli 侧据此决定不注入 callbacks）。
   */
  createHandler(sessionId: string): CallbackHandler | undefined;
  /** 刷新并等待待上报的 span 发送完成。未启用时为空操作。 */
  flush(): Promise<void>;
}

/** 未启用 tracing 时的 no-op 实现。 */
const noopTracing: Tracing = {
  createHandler: () => undefined,
  flush: async () => {},
};

/**
 * 初始化 tracing。
 *
 * - 配了 `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`：注册 OTel provider，
 *   返回可用的 handler 工厂与 flush。
 * - 没配：打印一行提示并返回 no-op（不抛错，保证玩具能离线跑）。
 *
 * 只应在进程启动时调用一次（provider 全局注册）。
 */
export function initTracing(): Tracing {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log(
      "ℹ️  未配置 Langfuse 密钥，tracing 未启用（agent 正常运行，只是不记录 trace）。",
    );
    return noopTracing;
  }

  // CLI 是短命进程：用 immediate 导出模式，避免 span 被攒在批里、
  // 进程退出时还没发出去。退出前再配合 flush() 兜底。
  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL,
    exportMode: "immediate",
  });

  new NodeTracerProvider({ spanProcessors: [processor] }).register();

  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  console.log(`🔭 Langfuse tracing 已启用 → ${baseUrl}`);

  return {
    // sessionId 让同一 thread 的多次运行在 UI 中归到同一个 session。
    createHandler: (sessionId: string) => new CallbackHandler({ sessionId }),
    flush: () => processor.forceFlush(),
  };
}

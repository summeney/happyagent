/**
 * Tracing 层：把 agent 与大模型的每次交互记录到 Langfuse。
 *
 * 接入方式（嵌入式运行时）：`initTracing()` 在配了 Langfuse 密钥时注册 OTel
 * provider 并返回一个 `CallbackHandler`；runtime 用 `graph.withConfig({ callbacks })`
 * 把它烘焙进已编译的 graph——LangChain 的 callbacks 会沿 graph 向下传播到每次
 * LLM 调用与每次工具调用，故整条 ReAct 循环都被记录（不改 graph/tools 实现）。
 *
 * 优雅降级：未配置密钥时整体为 no-op —— agent 照常运行、不产生 trace、不报错。
 */
import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface Tracing {
  /** 未启用时为 undefined；启用时是可挂到 callbacks 的 Langfuse handler。 */
  handler?: CallbackHandler;
  /** 刷新并等待待上报的 span 发送完成。未启用时为空操作。 */
  flush(): Promise<void>;
}

const noopTracing: Tracing = { handler: undefined, flush: async () => {} };

/**
 * 初始化 tracing（进程启动时调用一次，provider 全局注册）。
 * - 配了 `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`：注册 OTel provider，返回 handler。
 * - 没配：返回 no-op（不抛错，保证离线可跑）。
 */
export function initTracing(): Tracing {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) return noopTracing;

  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();

  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  console.error(`🔭 Langfuse tracing 已启用 → ${baseUrl}`);

  return {
    handler: new CallbackHandler(),
    flush: () => processor.forceFlush(),
  };
}

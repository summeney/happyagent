/**
 * 跨层共享的契约类型（渲染层 / 预加载 / 主进程 / 运行时共用）。
 *
 * 放在 src/shared 而非某个实现文件里：预加载桥与渲染层只应依赖"协议"，
 * 不应反向 import 主进程侧的实现文件（见 design.md D4/D5）。
 *
 * 注：这些是当前 IPC 模型下的契约类型；迁移到 LangGraph Server 后
 * （Group 3/5），运行事件将改由 SDK 的流式类型承载，此文件相应收敛。
 */

/** 一条会话目录项。 */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** 供渲染层展示的一条历史消息（已脱去 LangChain 类型，纯可序列化）。 */
export type UiMessage =
  | { role: "user"; text: string }
  | { role: "ai"; text: string; toolCalls: { name: string; args: unknown }[] }
  | { role: "tool"; text: string };

/** 一次运行过程中主进程 → 渲染层的单向事件。 */
export type RunEvent =
  | { type: "run:ai"; runId: string; threadId: string; text: string }
  | { type: "run:tool_call"; runId: string; threadId: string; name: string; args: unknown }
  | { type: "run:tool_result"; runId: string; threadId: string; text: string }
  | { type: "run:interrupt"; runId: string; threadId: string; command: string }
  | { type: "run:done"; runId: string; threadId: string }
  | { type: "run:error"; runId: string; threadId: string; message: string };

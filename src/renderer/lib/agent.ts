/**
 * 渲染层 agent 客户端（组合式）。
 *
 * 用 @langchain/langgraph-sdk 的 Client 经 HTTP/SSE 直连本机嵌入式 server
 * （url 由 preload 的 runtime 状态给出）。模块级响应式 store：
 *   - 每会话独立的消息列表与运行锁 → 支持并发多会话、后台运行、切换视图不中断
 *     （concurrent-sessions）。
 *   - 会话目录（列出/新建/切换）与自动标题（session-management）。
 *   - 增量呈现 AI 文本 / 工具调用 / 工具结果（desktop-ui）。
 */
import { reactive } from "vue";
import { Client } from "@langchain/langgraph-sdk";
import type { RuntimeStatus } from "../../shared/ipc.js";

export type UiMsg =
  | { role: "user"; text: string }
  | { role: "ai"; text: string }
  | { role: "tool_call"; name: string; args: unknown }
  | { role: "tool"; text: string };

export interface ThreadItem {
  id: string;
  title: string;
}

interface AgentState {
  status: RuntimeStatus["state"];
  threads: ThreadItem[];
  currentId: string | null;
  messages: Record<string, UiMsg[]>;
  running: Record<string, boolean>;
}

export const state = reactive<AgentState>({
  status: "starting",
  threads: [],
  currentId: null,
  messages: {},
  running: {},
});

let client: Client | null = null;
/** 每会话正在进行的运行的中止器，用于分别取消（concurrent-sessions）。 */
const controllers: Record<string, AbortController> = {};

function truncateTitle(text: string, max = 40): string {
  const first = text.trim().split("\n", 1)[0] ?? "";
  return first.length > max ? `${first.slice(0, max)}…` : first || "新会话";
}

/** 把一条 LangChain 消息（来自 getState 或流式 updates）转成 UI 消息。 */
function toUi(m: Record<string, unknown>): UiMsg[] {
  const type = m.type as string;
  const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
  if (type === "human") return [{ role: "user", text: content }];
  if (type === "ai") {
    const out: UiMsg[] = [];
    if (content.trim()) out.push({ role: "ai", text: content });
    for (const tc of (m.tool_calls as { name: string; args: unknown }[] | undefined) ?? []) {
      out.push({ role: "tool_call", name: tc.name, args: tc.args });
    }
    return out;
  }
  if (type === "tool") return [{ role: "tool", text: content }];
  return [];
}

/** 初始化：拿到 runtime 状态并订阅其变化。 */
export async function initAgent(): Promise<void> {
  applyStatus(await window.happyagent.getRuntimeStatus());
  window.happyagent.onRuntimeStatus(applyStatus);
}

function applyStatus(st: RuntimeStatus): void {
  state.status = st.state;
  if (st.state === "ready" && st.url) {
    client = new Client({ apiUrl: st.url });
    void refreshThreads();
  }
}

/** 刷新会话目录（按最近更新倒序）。 */
export async function refreshThreads(): Promise<void> {
  if (!client) return;
  const res = await client.threads.search({ limit: 100, sortBy: "updated_at", sortOrder: "desc" });
  state.threads = res.map((t) => ({
    id: t.thread_id,
    title: ((t.metadata as { title?: string } | undefined)?.title) || "新会话",
  }));
}

/** 新建空会话并切换过去。 */
export async function newThread(): Promise<void> {
  if (!client) return;
  const t = await client.threads.create();
  state.messages[t.thread_id] = [];
  await refreshThreads();
  state.currentId = t.thread_id;
}

/** 切换到某会话（首次加载其历史）。 */
export async function selectThread(id: string): Promise<void> {
  state.currentId = id;
  if (!state.messages[id]) await loadHistory(id);
}

async function loadHistory(id: string): Promise<void> {
  if (!client) return;
  const s = await client.threads.getState(id);
  const msgs = ((s.values as { messages?: Record<string, unknown>[] })?.messages) ?? [];
  state.messages[id] = msgs.flatMap(toUi);
}

/** 向当前会话发送一条消息并流式接收（运行锁仅作用于该会话）。 */
export async function send(text: string): Promise<void> {
  const id = state.currentId;
  if (!client || !id || state.running[id] || !text.trim()) return;

  state.running[id] = true;
  const controller = new AbortController();
  controllers[id] = controller;
  (state.messages[id] ??= []).push({ role: "user", text });

  // 首条消息 → 自动标题
  const item = state.threads.find((t) => t.id === id);
  if (!item || item.title === "新会话") {
    await client.threads.update(id, { metadata: { title: truncateTitle(text) } }).catch(() => {});
    await refreshThreads();
  }

  try {
    for await (const chunk of client.runs.stream(id, "agent", {
      input: { messages: [{ role: "human", content: text }] },
      streamMode: "updates",
      signal: controller.signal,
      // Langfuse 按会话分组：thread_id 作为 session 标识（llm-tracing 要求）
      config: { metadata: { langfuseSessionId: id } },
    })) {
      const ev = chunk as { event: string; data: Record<string, { messages?: Record<string, unknown>[] }> };
      if (ev.event === "updates") {
        for (const node of Object.keys(ev.data)) {
          for (const m of ev.data[node]?.messages ?? []) {
            for (const u of toUi(m)) state.messages[id].push(u);
          }
        }
      } else if (ev.event === "error") {
        state.messages[id].push({ role: "tool", text: `运行出错：${JSON.stringify((chunk as { data: unknown }).data)}` });
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      state.messages[id].push({ role: "tool", text: "（已取消）" });
    } else {
      state.messages[id].push({ role: "tool", text: `连接出错：${(e as Error).message}` });
    }
  } finally {
    state.running[id] = false;
    delete controllers[id];
    await refreshThreads();
  }
}

/** 取消某会话正在进行的运行；只影响该会话（其他并发会话不受影响）。 */
export function cancel(id: string): void {
  controllers[id]?.abort();
}

/**
 * 跨层 IPC 契约（主进程 ↔ 预加载 ↔ 渲染层）。
 *
 * Path S 下渲染层的 agent 数据经 HTTP/SSE 直连本机 server，不走 IPC；
 * 主进程经 IPC 暴露的只剩"运行时状态"这一原生能力（拿 server url、感知可用性）。
 */

/** 运行时（嵌入式 server）的可用性状态。 */
export interface RuntimeStatus {
  state: "starting" | "ready" | "unavailable";
  /** 就绪时的本机 server url（渲染层据此直连 HTTP/SSE）。 */
  url?: string;
}

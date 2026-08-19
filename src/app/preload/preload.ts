/**
 * 预加载桥（原生能力）。
 *
 * Path S 下渲染层的 agent 数据经 HTTP/SSE 直连本机 server，不走 IPC。
 * 这里只暴露渲染层需要的原生能力：查询运行时状态（拿 server url）、订阅状态变化。
 */
import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeStatus } from "../../shared/ipc.js";

export type { RuntimeStatus } from "../../shared/ipc.js";

const api = {
  /** 查询当前运行时状态（含就绪时的 server url）。 */
  getRuntimeStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke("runtime:status"),
  /** 订阅运行时状态变化；返回取消订阅函数。 */
  onRuntimeStatus: (handler: (status: RuntimeStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: RuntimeStatus) => handler(status);
    ipcRenderer.on("runtime:status", listener);
    return () => ipcRenderer.removeListener("runtime:status", listener);
  },
};

contextBridge.exposeInMainWorld("happyagent", api);

export type HappyagentApi = typeof api;

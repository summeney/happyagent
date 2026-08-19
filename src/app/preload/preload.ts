/**
 * 预加载桥。
 *
 * 渲染层不直接接触 Node / ipcRenderer；这里用 contextBridge 只暴露一组
 * 受限的方法（design.md D2）。请求-响应用 invoke，过程事件用 on 订阅。
 */
import { contextBridge, ipcRenderer } from "electron";
import type { RunEvent, SessionMeta, UiMessage } from "../../shared/ipc.js";

const api = {
  listSessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke("sessions:list"),
  createSession: (): Promise<SessionMeta> => ipcRenderer.invoke("sessions:create"),
  history: (threadId: string): Promise<UiMessage[]> =>
    ipcRenderer.invoke("sessions:history", threadId),
  send: (threadId: string, text: string): Promise<void> =>
    ipcRenderer.invoke("chat:send", threadId, text),
  resolveApproval: (runId: string, approved: boolean): Promise<void> =>
    ipcRenderer.invoke("approval:resolve", runId, approved),
  setApproval: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:setApproval", enabled),
  /** 订阅一次运行过程中的事件流；返回取消订阅函数。 */
  onRunEvent: (handler: (event: RunEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: RunEvent) => handler(payload);
    ipcRenderer.on("run:event", listener);
    return () => ipcRenderer.removeListener("run:event", listener);
  },
};

contextBridge.exposeInMainWorld("agent", api);

export type AgentApi = typeof api;

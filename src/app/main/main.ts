/**
 * Electron 主进程。
 *
 * 主进程本身就是 Node 进程，所以 agent 运行时（buildGraph）、SqliteSaver、
 * 工具（fs / run_bash）全都直接在这里跑，无需额外的 HTTP 服务
 * （见 design.md D1/D2）。渲染层经 preload 暴露的受限桥与本进程通信：
 *   - invoke（请求-响应）：sessions:* / chat:send / approval:resolve / settings:*
 *   - send（单向事件流）：run:event —— 一次运行过程中的 ai / 工具 / 中断 / 结束
 */
import "dotenv/config";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { SessionService } from "../../core/session/service.js";
import { resolveDbPath } from "../../core/session/paths.js";
import type { RunEvent } from "../../shared/ipc.js";

let service: SessionService;
let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    title: "happyagent",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "renderer", "index.html"));
}

function registerIpc(): void {
  // —— 请求-响应 ——
  ipcMain.handle("sessions:list", () => service.list());
  ipcMain.handle("sessions:create", () => service.create());
  ipcMain.handle("sessions:history", (_e, threadId: string) =>
    service.history(threadId),
  );
  ipcMain.handle("approval:resolve", (_e, runId: string, approved: boolean) => {
    service.resolveApproval(runId, approved);
  });
  ipcMain.handle("settings:setApproval", (_e, enabled: boolean) => {
    service.setApproval(enabled);
  });

  // —— 发消息：过程事件经 run:event 单向推回渲染层，Promise 在本轮结束时 resolve ——
  ipcMain.handle("chat:send", async (event, threadId: string, text: string) => {
    const emit = (e: RunEvent) => event.sender.send("run:event", e);
    await service.send(threadId, text, emit);
  });
}

app.whenReady().then(() => {
  service = new SessionService({
    dbPath: resolveDbPath(app.getPath("userData")),
    model: process.env.HAPPYAGENT_MODEL,
  });
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  service?.close();
  if (process.platform !== "darwin") app.quit();
});

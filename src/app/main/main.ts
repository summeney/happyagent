/**
 * Electron 主进程 —— 运行时"监工"。
 *
 * 不再在本进程执行 agent（见 design.md D3）。职责：
 *   1. 用 utilityProcess.fork 在独立进程拉起嵌入式运行时（src/app/server/entry）
 *   2. 等其就绪（parentPort 握手拿到本机 server url）后再建窗口
 *   3. 运行期守护：子进程异常退出按退避策略重启，并把可用性状态告知界面
 *   4. app 退出时优雅关闭子进程，不留孤儿
 *
 * 渲染层不经 IPC 跑 agent，而是经该 url 直连本机 server（HTTP/SSE）。
 * 主进程只经 IPC 暴露原生能力（当前：查询 runtime 状态/url）。
 */
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from "electron";
import type { RuntimeStatus } from "../../shared/ipc.js";

// 开发模式判据（见 design.md 决策 1）：以「渲染层 dev-server URL 是否由环境提供」为唯一开关，
// 并以 app.isPackaged 作硬保险——打包态即便存在该变量也绝不进入开发模式。
// isDev 同时门控：loadURL vs loadFile、runtime 是否加 --inspect、runtime 端口是否钉死。
const devServerUrl = process.env.HAPPYAGENT_RENDERER_URL;
const isDev = !app.isPackaged && !!devServerUrl;

// 开发态固定端口约定（见 design.md 决策 4/5）。
const DEV_RUNTIME_PORT = "2024"; // runtime HTTP/SSE 监听端口，便于 curl 手测
const DEV_RUNTIME_INSPECT_PORT = "9230"; // runtime 子进程调试端口，与主进程 9229 相异

let child: UtilityProcess | null = null;
let status: RuntimeStatus = { state: "starting" };
let win: BrowserWindow | null = null;
let quitting = false;
let restartAttempts = 0;

/** 广播运行时状态给渲染层。 */
function broadcastStatus(): void {
  win?.webContents.send("runtime:status", status);
}

/** fork 运行时子进程，返回一个在其就绪时 resolve(url) 的 Promise。 */
function forkRuntime(): Promise<string> {
  const entry = join(__dirname, "runtime.mjs");
  return new Promise((resolve, reject) => {
    const proc = utilityProcess.fork(entry, [], {
      env: {
        ...process.env,
        HAPPYAGENT_DB_DIR: app.getPath("userData"),
        HAPPYAGENT_MODEL: process.env.HAPPYAGENT_MODEL ?? "",
        // agent 工作目录（工具相对路径的根）。当前默认启动 cwd；
        // 未来应按会话/项目可选（design.md Open Questions）。
        HAPPYAGENT_WORKDIR: process.env.HAPPYAGENT_WORKDIR ?? app.getAppPath(),
        // 开发态钉死 runtime 端口，便于 curl 手测 HTTP/SSE；生产不注入 → entry.ts 用 port:0 随机。
        ...(isDev ? { HAPPYAGENT_PORT: process.env.HAPPYAGENT_PORT ?? DEV_RUNTIME_PORT } : {}),
      },
      // node:sqlite 在内置 Node 下仍是实验特性，需显式开启。
      // 开发态追加 --inspect 使 runtime 子进程可被调试器 attach 下断点。
      execArgv: isDev
        ? ["--experimental-sqlite", `--inspect=${DEV_RUNTIME_INSPECT_PORT}`]
        : ["--experimental-sqlite"],
      stdio: "inherit",
    });
    child = proc;

    proc.on("message", (msg: { type?: string; url?: string; message?: string }) => {
      if (msg?.type === "ready" && msg.url) {
        restartAttempts = 0;
        status = { state: "ready", url: msg.url };
        broadcastStatus();
        resolve(msg.url);
      } else if (msg?.type === "error") {
        reject(new Error(msg.message ?? "运行时启动失败"));
      }
    });

    proc.on("exit", (code) => {
      child = null;
      if (quitting) return;
      // 非预期退出：标记不可用并按退避重启
      status = { state: "unavailable" };
      broadcastStatus();
      const delay = Math.min(1000 * 2 ** restartAttempts, 15_000);
      restartAttempts++;
      console.error(`运行时子进程退出（code=${code}），${delay}ms 后重启（第 ${restartAttempts} 次）`);
      setTimeout(() => {
        status = { state: "starting" };
        broadcastStatus();
        forkRuntime().catch((e) => console.error("重启失败：", e));
      }, delay);
    });
  });
}

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
  // 开发态从 Vite dev server 加载（HMR + 真 .vue/.ts sourcemap），并自动打开 DevTools；
  // 生产态仍加载打包后的渲染产物。
  if (isDev && devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, "renderer", "index.html"));
  }
  win.webContents.on("did-finish-load", broadcastStatus);
}

// 渲染层查询当前运行时状态（含 url）。
ipcMain.handle("runtime:status", () => status);

app.whenReady().then(async () => {
  try {
    await forkRuntime();
  } catch (e) {
    status = { state: "unavailable" };
    console.error("运行时首次启动失败：", e);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
  child?.postMessage({ type: "shutdown" });
  // 兜底：给子进程一点时间优雅退出，超时则强杀
  setTimeout(() => child?.kill(), 2000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * 开发态 Electron 启动器（自动重启）。
 *
 * 由 `npm run dev` 经 concurrently 与 Vite dev server、esbuild --watch 并行拉起。职责：
 *   1. 等首个 esbuild 产物（dist-electron/main.cjs）就绪后再启动 Electron，避免竞态
 *   2. 以开发态启动 Electron：注入 HAPPYAGENT_RENDERER_URL（→ 主进程进入 isDev 分支），
 *      并给主进程开 --inspect=9229 供调试器 attach
 *   3. 监视 dist-electron/{main.cjs,preload.cjs,runtime.mjs} 变化，去抖后 kill + 重启 Electron
 *      （Node 进程无法热替换，重启是唯一手段；渲染层由 Vite HMR 独立热更，不触发重启）
 *   4. 用户关闭应用窗口（Electron 自行退出）→ 结束 dev
 *
 * 端口约定：9229 主进程 / 9230 runtime（见 main.ts）/ 5173 Vite / 2024 runtime HTTP。
 */
import electronPath from "electron";
import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist-electron");
const mainFile = resolve(outdir, "main.cjs");
const RENDERER_URL = process.env.HAPPYAGENT_RENDERER_URL ?? "http://localhost:5173";

let child = null;
let restarting = false;
let debounce = null;

function start() {
  child = spawn(electronPath, ["--inspect=9229", "."], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      // node:sqlite 实验特性（与 npm run desktop 一致）
      NODE_OPTIONS: "--experimental-sqlite",
      // 该变量存在即触发主进程 isDev 分支（loadURL + runtime --inspect + 固定端口）
      HAPPYAGENT_RENDERER_URL: RENDERER_URL,
    },
  });
  child.on("exit", (code) => {
    if (restarting) return; // 我们主动重启，忽略本次退出
    // 用户关窗 → 结束整个 dev（concurrently -k 会连带停掉 vite / esbuild）
    process.exit(code ?? 0);
  });
}

function restart() {
  if (!child) return start();
  restarting = true;
  child.once("exit", () => {
    restarting = false;
    start();
  });
  child.kill();
}

/** 轮询等待首个 esbuild 产物就绪，再启动并开始监视。 */
function waitForBuildThenStart() {
  if (!existsSync(mainFile)) {
    setTimeout(waitForBuildThenStart, 100);
    return;
  }
  start();
  // esbuild 在其进程启动时已 rmSync 一次 outdir；此刻产物已重建，目录稳定，可安全监视。
  watch(outdir, (_event, filename) => {
    if (!filename || !/(?:main\.cjs|preload\.cjs|runtime\.mjs)$/.test(filename)) return;
    clearTimeout(debounce);
    debounce = setTimeout(restart, 200); // 去抖：保存瞬间多次触发合并为一次重启
  });
}

// 优雅退出：确保子 Electron 一并被杀
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restarting = true;
    child?.kill();
    process.exit(0);
  });
}

waitForBuildThenStart();

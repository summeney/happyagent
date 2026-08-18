/**
 * 用 esbuild 打包 Electron 主进程与 preload。
 *
 * 为什么打包：主进程要 import 项目里的 ESM 源码（src/session/*）与 langchain
 * 全家桶，直接在 Electron 里跑 ESM 摩擦大。把它们一次性打进 dist-electron/*.cjs
 * （CJS 产物，Electron 主进程无需 ESM loader）。只把 electron 外置；持久化用
 * 运行时内置的 node:sqlite（`node:` 前缀模块 esbuild 会自动外置），无原生模块、
 * 无需 electron-rebuild（见 design.md D4 / 风险 R2）。
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist-electron");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [resolve(root, "electron/main.ts")],
  outfile: resolve(outdir, "main.cjs"),
});

await build({
  ...common,
  entryPoints: [resolve(root, "electron/preload.ts")],
  outfile: resolve(outdir, "preload.cjs"),
});

// 渲染层是纯静态资源，直接拷贝
cpSync(resolve(root, "electron/renderer"), resolve(outdir, "renderer"), {
  recursive: true,
});

console.log("✅ Electron 打包完成 → dist-electron/");

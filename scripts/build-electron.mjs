/**
 * 用 esbuild 打包 Electron 三个入口 + 拷贝渲染层。
 *
 * - main / preload：CJS（Electron 主进程/预加载，electron 外置）。main 只 fork 运行时，
 *   不 import 任何 ESM-only 依赖，故可安全打成 CJS。
 * - runtime（utilityProcess 入口）：ESM。它经 graph → model/tools 间接依赖
 *   @langchain/*、hono、@langchain/langgraph-api（均 ESM-only），必须打成 ESM。
 *   node: 前缀模块（含 node:sqlite）由 esbuild 自动外置，无原生编译。
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
  target: "node20",
  sourcemap: true,
  logLevel: "info",
};

// main + preload：CJS，外置 electron
await build({
  ...common,
  format: "cjs",
  external: ["electron"],
  entryPoints: [resolve(root, "src/app/main/main.ts")],
  outfile: resolve(outdir, "main.cjs"),
});

await build({
  ...common,
  format: "cjs",
  external: ["electron"],
  entryPoints: [resolve(root, "src/app/preload/preload.ts")],
  outfile: resolve(outdir, "preload.cjs"),
});

// runtime：ESM，只打进我们自己的 src/*；所有 node_modules 依赖外置。
// 关键：langchain/langgraph 等会用 import.meta.url 读自身 package.json 做版本检测，
// 若被打进 bundle，import.meta.url 变为 bundle 位置 → 相对路径错指、ENOENT。
// 外置后它们在运行时从 node_modules 加载，import.meta.url 正确（分发时随包携带 node_modules）。
await build({
  ...common,
  format: "esm",
  packages: "external",
  entryPoints: [resolve(root, "src/app/server/entry.ts")],
  outfile: resolve(outdir, "runtime.mjs"),
});

// 渲染层静态资源
cpSync(resolve(root, "src/renderer"), resolve(outdir, "renderer"), { recursive: true });

console.log("✅ Electron 打包完成 → dist-electron/（main.cjs · preload.cjs · runtime.mjs · renderer/）");

/**
 * 用 esbuild 打包 Electron 三个入口 + 拷贝渲染层。
 *
 * - main / preload：CJS（Electron 主进程/预加载，electron 外置）。main 只 fork 运行时，
 *   不 import 任何 ESM-only 依赖，故可安全打成 CJS。
 * - runtime（utilityProcess 入口）：ESM。它经 graph → model/tools 间接依赖
 *   @langchain/*、hono、@langchain/langgraph-api（均 ESM-only），必须打成 ESM。
 *   node: 前缀模块（含 node:sqlite）由 esbuild 自动外置，无原生编译。
 *
 * 用法：
 *   node scripts/build-electron.mjs          一次性构建（main/preload/runtime + Vite 渲染层）
 *   node scripts/build-electron.mjs --watch  监视增量重建 main/preload/runtime（渲染层由 Vite dev server 负责，故跳过）
 */
import { build, context } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist-electron");
const watch = process.argv.includes("--watch");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
};

// 三个 Electron 入口的 esbuild 配置（一次性构建与 watch 复用同一份，保证 dev/prod 同管线）。
const electronBuilds = [
  // main：CJS，外置 electron
  {
    ...common,
    format: "cjs",
    external: ["electron"],
    entryPoints: [resolve(root, "src/app/main/main.ts")],
    outfile: resolve(outdir, "main.cjs"),
  },
  // preload：CJS，外置 electron
  {
    ...common,
    format: "cjs",
    external: ["electron"],
    entryPoints: [resolve(root, "src/app/preload/preload.ts")],
    outfile: resolve(outdir, "preload.cjs"),
  },
  // runtime：ESM，只打进我们自己的 src/*；所有 node_modules 依赖外置。
  // 关键：langchain/langgraph 等会用 import.meta.url 读自身 package.json 做版本检测，
  // 若被打进 bundle，import.meta.url 变为 bundle 位置 → 相对路径错指、ENOENT。
  // 外置后它们在运行时从 node_modules 加载，import.meta.url 正确（分发时随包携带 node_modules）。
  {
    ...common,
    format: "esm",
    packages: "external",
    entryPoints: [resolve(root, "src/app/server/entry.ts")],
    outfile: resolve(outdir, "runtime.mjs"),
  },
];

if (watch) {
  // watch 模式：只增量重建 main/preload/runtime → dist-electron/。
  // 渲染层不在此构建——开发态由 Vite dev server（HMR）提供，见 npm run dev 编排。
  const ctxs = await Promise.all(electronBuilds.map((cfg) => context(cfg)));
  await Promise.all(ctxs.map((ctx) => ctx.watch()));
  console.log("👀 watch 中 → dist-electron/（main.cjs · preload.cjs · runtime.mjs）；渲染层由 Vite dev server 负责");
} else {
  await Promise.all(electronBuilds.map((cfg) => build(cfg)));

  // 渲染层：Vue 3 应用经 Vite 构建到 dist-electron/renderer
  const { build: viteBuild } = await import("vite");
  await viteBuild({ configFile: resolve(root, "vite.config.ts"), logLevel: "warn" });

  console.log("✅ Electron 打包完成 → dist-electron/（main.cjs · preload.cjs · runtime.mjs · renderer/）");
}

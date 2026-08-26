## Why

当前项目没有开发/调试启动模式：任何一次代码改动都要先 `npm run build:electron` 全量重建、再重启应用才能看到效果；三个进程（Electron 主进程、被 fork 的 runtime server、Vue 渲染层）都没有可 attach 的调试端口，`.vscode/launch.json` 也不存在。渲染层始终 `loadFile` 打包产物，且 Vite build 未开 sourcemap，F12 里只能看到打包后的代码。这让"改代码、看效果、下断点"三件最高频的开发动作都很痛。

本次改动引入一个受环境变量门控的开发模式，让开发者能"在 VSCode 里点 Debug 一键启动、对服务端下断点，同时前端改动实时热更、可在 F12 或 VSCode 里断点 Vue"，且**生产路径与可观察行为完全不变**。

## What Changes

- **新增开发模式门控**：主进程以「渲染层 dev-server URL 环境变量是否存在」为唯一开关，并以 `app.isPackaged` 作为生产硬保险，判定是否进入开发模式。生产（打包）路径不受任何影响。
- **渲染层开发态热更**：开发模式下窗口改为 `loadURL(Vite dev server)` 而非 `loadFile`，获得 HMR、保状态热更与真实 `.vue`/`.ts` sourcemap；生产仍 `loadFile` 打包产物。
- **runtime server 可调试**：开发模式下 `utilityProcess.fork` 的 `execArgv` 追加 `--inspect=<固定端口>`，使服务端进程可被 VSCode/Chrome attach 下断点；并在开发模式下将 runtime 监听端口钉死为固定值，便于 `curl` 手测 HTTP/SSE。
- **主进程可调试**：开发模式经 `electron --inspect` 启动，主进程可被 attach。
- **新增开发启动编排**：新增 `npm run dev` 脚本，并行启动 Vite dev server、esbuild `--watch` 增量重建 main/runtime、以及在产物变化时自动重启 Electron 的启动器。
- **新增 `.vscode/launch.json`**：提供 compound 调试配置，一键启动并 attach 主进程与 runtime 子进程（渲染层默认 F12，另附可选的 chrome attach 配置）。
- **文档更新**：README「开发调试」小节补充开发模式与调试用法。

上述均为**新增能力**，不移除或改变任何现有生产行为，无 BREAKING 变更。

## Capabilities

### New Capabilities
- `dev-debug-mode`: 定义开发模式的可观察行为——开发模式的触发与生产隔离、三个进程（主/运行时/渲染）在开发态下的调试可达性与实时反馈（HMR）、以及一键启动与自动重启的开发编排。

### Modified Capabilities
<!-- 无：本次改动为纯增量的开发态能力，不改变任何现有生产行为，故不修改现有能力的需求。 -->

## Impact

- **受影响代码**：
  - `src/app/main/main.ts`：`createWindow`（loadURL vs loadFile 门控）、`forkRuntime`（execArgv 追加 inspect、开发态固定端口）。
  - `scripts/build-electron.mjs`：抽出/新增 watch 模式（esbuild `context().watch()`）。
  - 新增开发启动器脚本（编排 Vite dev server + esbuild watch + 自动重启 Electron）。
- **新增文件**：`.vscode/launch.json`（及可能的 `.vscode/tasks.json`）。
- **配置**：`package.json` 新增 `dev` 相关脚本；开发态环境变量约定（渲染层 dev-server URL、runtime 固定端口、inspect 端口）。
- **依赖**：可能新增少量开发依赖（如 `concurrently`，或复用现有 `vite`/`esbuild`/`electron`；自动重启可自写极小启动器或引入 `electronmon`——具体在 design 决定）。
- **不影响**：生产打包产物、`npm run desktop` 现有行为、runtime 的生产随机端口与本机监听约束、渲染层生产 `loadFile` 路径。

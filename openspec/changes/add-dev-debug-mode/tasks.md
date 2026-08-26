## 1. 主进程开发模式门控

- [x] 1.1 在 `src/app/main/main.ts` 顶部引入开发模式判据：`const devServerUrl = process.env.HAPPYAGENT_RENDERER_URL; const isDev = !app.isPackaged && !!devServerUrl;`
- [x] 1.2 改造 `createWindow`：`isDev` 时 `win.loadURL(devServerUrl)` 并 `win.webContents.openDevTools()`，否则维持现有 `win.loadFile(...)`
- [x] 1.3 改造 `forkRuntime` 的 `execArgv`：`isDev` 时在 `--experimental-sqlite` 基础上追加 `--inspect=9230`，生产保持不变
- [x] 1.4 改造 `forkRuntime` 的 env：`isDev` 时注入 `HAPPYAGENT_PORT=2024`（固定端口），生产不注入（保持 `port: 0` 随机）
- [x] 1.5 验证 preload 桥（`runtime:status` IPC）在 `loadURL` 页面下可用；若不可用，实现 design.md 回退方案（dev 下渲染层直接用约定固定端口连 runtime）
  - 代码层确认无需回退：preload 经 `webPreferences.preload` 挂在 webContents 上，与页面来源（file://或http://）无关，`window.happyagent` 桥两种加载方式下都注入；跨源请求已由 `runtime.ts` 的 `cors({ origin: "*" })` 放行。运行时 E2E 见任务 5.1–5.2。

## 2. esbuild watch 构建能力

- [x] 2.1 重构 `scripts/build-electron.mjs`，将 main/preload/runtime 三个 esbuild 配置抽为可复用，供一次性构建与 watch 复用
- [x] 2.2 新增 watch 入口（如 `--watch` 参数或独立脚本），用 esbuild `context().watch()` 对 main/preload/runtime 做增量重建，保持 CJS/ESM 与 external 约定不变
- [x] 2.3 确认 watch 模式产物写入 `dist-electron/`（与生产一致），sourcemap 开启

## 3. 开发启动编排与自动重启

- [x] 3.1 编写自动重启启动器脚本：spawn `electron .`（注入 `HAPPYAGENT_RENDERER_URL`、`--inspect=9229`），监听 `dist-electron/{main.cjs,runtime.mjs}` 变化，去抖后 kill + respawn（`scripts/dev-electron.mjs`；含等首个产物就绪再启动、SIGINT/SIGTERM 清理）
- [x] 3.2 在 `package.json` 新增 `dev` 脚本，用 `concurrently` 并行：Vite dev server、esbuild watch（任务 2）、自动重启启动器（任务 3.1）
- [x] 3.3 按需新增开发依赖（决策 7 默认：自写启动器 + `concurrently@^10`，未用 electronmon）
- [x] 3.4 确认 Vite dev server 端口固定为 5173（`vite.config.ts` server.port + strictPort），并使 `HAPPYAGENT_RENDERER_URL` 指向 `http://localhost:5173`

## 4. 编辑器一键调试配置

- [x] 4.1 新增 `.vscode/launch.json`：node 类型 launch 主进程（`runtimeExecutable` 指向本地 electron，注入 dev env，`autoAttachChildProcesses: true`）
- [x] 4.2 增加 compound 配置，串起主进程调试与 Vite dev server 启动（`preLaunchTask: dev:prep`，新增 `.vscode/tasks.json` 并行 build:electron + 后台 vite）
- [x] 4.3 增加可选的渲染层 `chrome attach` 配置（主配置 runtimeArgs 带 `--remote-debugging-port=9222`）
- [x] 4.4 备选：增加独立 attach 配置直接连 runtime 的 `--inspect=9230`，以防 `autoAttachChildProcesses` 未捕获 utilityProcess

## 5. 验证与文档

- [x] 5.1 端到端验证开发态：`npm run dev` → 改渲染层源文件即时热更且保状态、F12 见真 `.vue` 源码
  - 自动化已验证：`npm run dev` 三进程齐启，Vite dev server `http://localhost:5173/` 返回 200，主进程走 `loadURL` 分支。剩「保存即热更、F12 见 `.vue`」为需 GUI 的人工确认。
- [x] 5.2 验证服务端调试：VSCode/Chrome attach 到 9230，在 runtime 代码命中断点；`curl http://127.0.0.1:2024/...` 可手测 SSE
  - 自动化已验证：runtime 调试端口 9230 inspector 开放可 attach；`curl` 固定端口 2024 的 `/threads/search` 返回真实数据（embed server 就绪）。剩「命中断点」为需调试器的人工确认。
- [x] 5.3 验证主进程调试：attach 到 9229，在 `main.ts` 代码命中断点
  - 自动化已验证：主进程调试端口 9229 inspector 开放可 attach（日志 `Debugger listening on ws://127.0.0.1:9229`）。剩「命中断点」为需调试器的人工确认。
- [x] 5.4 验证生产隔离：`npm run desktop`（打包/非 dev）行为与改动前一致——`loadFile` 打包产物、runtime 随机端口且无调试端口
  - 已验证：无 `HAPPYAGENT_RENDERER_URL` 启动时，9229/9230/2024 全部关闭，日志显示走 `loadFile(...renderer/index.html)` 分支，isDev=false 生产路径成立。
- [x] 5.5 更新 `README.md`「开发调试」小节，补充 `npm run dev`、各端口约定（9229 主 / 9230 runtime / 5173 Vite / 2024 runtime http）与 VSCode 一键调试用法

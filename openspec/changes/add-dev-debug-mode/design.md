## Context

动机见 [proposal.md](proposal.md) — Why。此处只记录塑造方案的现状与约束：

- 应用是**三进程**结构：Electron 主进程（`main.cjs`，CJS）→ `utilityProcess.fork` 拉起 runtime server（`runtime.mjs`，ESM）→ 渲染层 Vue（Chromium 窗口，经 HTTP/SSE 连 runtime）。
- 现有构建管线 [scripts/build-electron.mjs](../../../scripts/build-electron.mjs) 是**刻意手写**的 esbuild + Vite，注释明确记录了两个必须驯服的雷：① langchain 系用 `import.meta.url` 读自身 package.json 做版本检测，被打进 bundle 会路径错指 ENOENT，故 runtime 必须 ESM + `packages: external`；② main 必须 CJS 外置 electron。
- 渲染层经 `file://` 加载（`base: './'`），当前 `win.loadFile(...)`；[vite.config.ts](../../../vite.config.ts) 未开 `build.sourcemap`。
- runtime 由 [main.ts](../../../src/app/main/main.ts) 以 `execArgv: ["--experimental-sqlite"]` fork，端口 `port: 0`（随机），就绪后经 `parentPort` 回传 url，渲染层经 `runtime:status` IPC 发现该 url。
- 约束：`node:sqlite` 仍是实验特性，任何运行 runtime 的方式都必须带 `--experimental-sqlite`。

指导原则（用户明确）：**开发模式下，调试便利 + 改代码实时可见优先。**

## Goals / Non-Goals

**Goals:**
- 一条命令进入"可热更、可断点、可 attach"的开发态；主进程与 runtime 在 VSCode 里一键调试，渲染层 F12/编辑器可断点于真源码。
- 生产路径与可观察行为零改变（打包态硬隔离）。
- 复用现有 esbuild/Vite 管线，保持 **dev/prod 同一条打包路径**，避免"dev 能跑、build 崩"。

**Non-Goals:**
- 不追求 main/runtime 的"免重启热替换"（Node 进程做不到；目标是重启全自动且快）。
- 不引入 electron-vite / vite-plugin-electron 等框架去重构目录结构。
- 不改变 runtime 的生产随机端口、仅本机监听、生命周期守护等既有行为。
- 不改变渲染层与 runtime 的连接方式（仍经 IPC 发现 url + HTTP/SSE）。

## Decisions

### 决策 1：开发模式以「渲染层 dev-server URL 环境变量存在与否」为唯一开关，`app.isPackaged` 兜底

```ts
const devServerUrl = process.env.HAPPYAGENT_RENDERER_URL;   // dev 脚本注入
const isDev = !app.isPackaged && !!devServerUrl;
```

**理由**：dev 下必须知道 Vite dev server 地址才能 `loadURL`——让"地址存在"直接充当"是否 dev"，你需要的值本身就是开关，杜绝布尔量（`DEV=1`）与现实漂移（设了标志却没开 Vite / 端口对不上）。`app.isPackaged` 是 Electron 内建、打包必为 `true` 的权威信号，作硬保险：即便环境变量泄漏进打包产物，正式应用也绝不进入 dev。

**备选（否决）**：`NODE_ENV=development`——被生态大量库读写，语义被污染，不适合当自有进程编排开关；独立 `HAPPYAGENT_DEV=1` 布尔量——多一个可与现实漂移的事实来源。

`isDev` 同时门控三件事：`loadURL` vs `loadFile`、runtime 是否加 `--inspect`、runtime 端口是否钉死。

### 决策 2：渲染层开发态用 Vite dev server + HMR，不再 `loadFile`

`createWindow` 中：`isDev ? win.loadURL(devServerUrl)（+ 自动开 DevTools） : win.loadFile(...)`。

**理由**：在"实时可见优先"的原则下这是最大赢点——反馈从"秒级重建+重启"压到亚秒热更且保状态；Vite dev 直接提供原始源码 = 真 `.vue`/`.ts` sourcemap 白送，F12/编辑器断点即解决"调 Vue"；Vue Devtools 可用。备选"给 build 开 sourcemap + F12"每次仍需整包 rebuild + 重启，直接违背优先级，否决。

**验证点**：渲染层需在 `loadURL` 页面下仍能经 preload 桥拿到 `runtime:status`。preload 桥与页面来源无关（走 contextBridge），预期可用——列为实现时的显式验证步骤，不作假设。

### 决策 3：main/runtime 用 esbuild `--watch` 增量重建 + 自动重启 Electron，不改用 tsx 直跑

- 渲染层（Vue）：HMR，亚秒，保状态（90% 改动）。
- main + runtime：esbuild watch（≈10–50ms 增量）→ 自动重启 Electron（≈1–2s）。

**理由**：Node 进程无法热替换，必须重启；目标不是免重启而是重启全自动、够快。继续走 esbuild 保证 **dev/prod 同一条打包管线**——[build-electron.mjs](../../../scripts/build-electron.mjs) 注释里的 `import.meta.url` / CJS-ESM 两个雷正是它在驯服；tsx 直跑源码会引入第二套、与生产不同的模块解析路径，恰可能踩雷。为省 ~1s 重启牺牲 dev/prod 一致性不划算。真正耗时是 Electron 重启，对 Node 进程本就不可避免，接受它是诚实的。

### 决策 4：开发态钉死 runtime 端口

开发态经 `HAPPYAGENT_PORT`（如 `2024`）传入固定端口；生产仍 `port: 0` 随机。[entry.ts](../../../src/app/server/entry.ts) 已读取 `HAPPYAGENT_PORT`，故只需在 dev 编排里注入该 env，无需改 entry。

**理由**：端口可预测，开发者可直接 `curl http://127.0.0.1:2024/...` 手测 HTTP/SSE，脱离 UI 调服务端——附带红利。不改变生产随机端口行为。

### 决策 5：runtime 开发态 fork 追加 `--inspect=<固定端口>`

`forkRuntime` 的 `execArgv`：生产 `["--experimental-sqlite"]`；开发 `["--experimental-sqlite", "--inspect=9230"]`。主进程侧经 `electron --inspect=9229` 启动（由 dev 脚本 / launch.json 指定）。两端口须相异（9229 主 / 9230 runtime）。

**理由**：utilityProcess 的 `execArgv` 支持 inspect 标志，是让被 fork 的服务端进程可 attach 的标准手段。

### 决策 6：`.vscode/launch.json` 用 compound + `autoAttachChildProcesses`

主配置：node 类型 launch，`runtimeExecutable` 指向本地 `electron`，注入 `HAPPYAGENT_RENDERER_URL`/`HAPPYAGENT_PORT`，开启 `autoAttachChildProcesses: true`——因 runtime 是带 `--inspect` 的 fork 子进程，VSCode 自动 attach，**一个配置同时断点 main + runtime**。渲染层首选 **F12**（零配置，配 Vite sourcemap 已够用），另附可选 `chrome attach` 配置（应用需带 `--remote-debugging-port=9222`）供在 VSCode 内断点 Vue。

**理由**：单配置覆盖两 Node 进程，编排最简。渲染层调试大多数场景 F12 足够，VSCode chrome-attach 作为可选加值。

### 决策 7：dev 编排用 `concurrently` 并行三件事，自动重启用极小自写启动器

`npm run dev` = `concurrently`：(1) `vite`（渲染层 dev server）、(2) esbuild `context().watch()`（main+runtime 增量）、(3) 一个监听 `dist-electron/{main.cjs,runtime.mjs}` 变化即重启 electron 的启动器。

**理由**：与项目"手写 esbuild、不引框架"的既有取向一致；自写启动器只需十几行（spawn electron + 监听产物 + kill/respawn），比引入 `electronmon` 更可控、依赖更少。`concurrently` 是轻量成熟的并行器。备选 `electronmon` 记为可接受的替代，若自写启动器成本超预期可换。

## Risks / Trade-offs

- **preload 桥在 `loadURL` 下失效** → 决策 2 已列为显式验证步骤；若失效，回退方案是 dev 下经 URL 查询串或固定端口约定把 runtime url 传给渲染层（因 dev 端口已钉死，渲染层可直接用约定端口，无需 IPC 发现）。
- **两个 inspect 端口 / dev server 端口冲突** → 端口固定且分离（9229 主 / 9230 runtime / 5173 Vite / 2024 runtime http），文档写明；被占用时启动器给出清晰报错。
- **自动重启抖动**（保存瞬间多次触发重建/重启）→ 启动器对重启做去抖（debounce），esbuild 增量足够快，实际影响小。
- **dev 引入的 env/端口约定与生产漂移** → 所有 dev 行为统一由 `isDev` 门控，生产分支一字不改；`app.isPackaged` 兜底，打包态强制走生产路径。
- **`autoAttachChildProcesses` 未能捕获 utilityProcess** → 因已显式给 runtime 固定 `--inspect=9230`，可退化为在 launch.json 里加一条独立的 attach 配置（attach 到 9230），不依赖自动附加。

## Open Questions

- 自动重启启动器最终自写还是采用 `electronmon`——不影响 specs、方案与任务拆分，实现时按成本择一（决策 7 已定默认与回退）。

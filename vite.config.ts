import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Electron 渲染层经 file:// 加载，需相对资源路径（base './'）。
export default defineConfig({
  root: resolve(root, "src/renderer"),
  base: "./",
  plugins: [vue()],
  // 开发态 dev server 端口钉死；主进程经 HAPPYAGENT_RENDERER_URL=http://localhost:5173 加载。
  // strictPort：端口被占用则直接失败，避免漂移到别的端口导致主进程连不上。
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(root, "dist-electron/renderer"),
    emptyOutDir: true,
  },
});

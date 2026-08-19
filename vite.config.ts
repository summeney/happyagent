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
  build: {
    outDir: resolve(root, "dist-electron/renderer"),
    emptyOutDir: true,
  },
});

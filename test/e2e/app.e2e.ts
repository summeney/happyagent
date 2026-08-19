import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 全测试共享一个隔离的 userData，用于验证跨重启持久化。
const userData = mkdtempSync(join(tmpdir(), "happyagent-e2e-"));

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    env: { ...process.env, HAPPYAGENT_WORKDIR: process.cwd() },
  });
}

const THREAD_TITLE = "只回复两个字：你好";

test("新建会话 → 发消息 → 流式收到 AI 答复", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".statusbar")).toContainText("就绪", { timeout: 40_000 });

    await page.getByRole("button", { name: /新建/ }).click();
    const ta = page.locator("textarea");
    await ta.fill(THREAD_TITLE);
    await ta.press("Enter");

    // 用户消息立即出现
    await expect(page.locator(".msg.user")).toContainText("你好", { timeout: 10_000 });
    // AI 答复流式到达
    await expect(page.locator(".msg.ai").first()).toBeVisible({ timeout: 90_000 });
    // 侧栏出现该会话（标题取首条消息）
    await expect(page.locator(".threads .title").first()).toContainText("你好");
  } finally {
    await app.close();
  }
});

test("重启后会话历史持久化（跨重启读回）", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".statusbar")).toContainText("就绪", { timeout: 40_000 });
    // 上一测试创建的会话应仍在目录中
    await expect(page.locator(".threads .title").first()).toContainText("你好", { timeout: 15_000 });
    // 点击打开，历史消息读回
    await page.locator(".threads li").first().click();
    await expect(page.locator(".msg.user")).toContainText("你好", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

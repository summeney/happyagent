// 占位 renderer：验证 main↔utilityProcess↔runtime 链路 + renderer→server 连通。
// Group 5 将以 Vue 3 + @langchain/vue useStream 替换。

const stateEl = document.getElementById("state");
const urlEl = document.getElementById("url");
const connEl = document.getElementById("conn");

async function probe(url) {
  // 任意响应（含 404）即证明 HTTP 链路连通；用 SDK 的 threads 搜索端点。
  try {
    const res = await fetch(`${url}/threads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, offset: 0 }),
    });
    connEl.textContent = `已连通（HTTP ${res.status}）`;
    connEl.className = "ok";
  } catch (e) {
    connEl.textContent = `失败：${e.message}`;
    connEl.className = "bad";
  }
}

function render(status) {
  const labels = { starting: "启动中…", ready: "已就绪", unavailable: "不可用" };
  stateEl.textContent = labels[status.state] ?? status.state;
  stateEl.className = status.state === "ready" ? "ok" : status.state === "unavailable" ? "bad" : "wait";
  urlEl.textContent = status.url ?? "—";
  if (status.state === "ready" && status.url) probe(status.url);
}

const api = window.happyagent;
if (api) {
  api.getRuntimeStatus().then(render);
  api.onRuntimeStatus(render);
} else {
  stateEl.textContent = "preload 桥不可用";
  stateEl.className = "bad";
}

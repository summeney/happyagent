/**
 * 渲染层逻辑（纯浏览器 JS，无构建步骤）。
 * 只通过 preload 暴露的 window.agent.* 与主进程通信。
 */

const el = (id) => document.getElementById(id);
const sessionListEl = el("session-list");
const messagesEl = el("messages");
const inputEl = el("input");
const composerEl = el("composer");
const sendBtn = el("send");
const newBtn = el("new-session");
const approvalToggle = el("approval");
const modal = el("approval-modal");
const modalCmd = el("approval-command");

const state = {
  currentThreadId: null,
  running: false,
  pendingRunId: null, // 待审批的 runId
  aiTurnEl: null, // 当前 AI 回合的容器（用于增量追加）
};

// ---------- 会话列表 ----------

async function loadSessions(selectId) {
  const sessions = await window.agent.listSessions();
  renderSessions(sessions);
  if (selectId) {
    await selectSession(selectId);
  } else if (!state.currentThreadId) {
    if (sessions.length > 0) await selectSession(sessions[0].id);
    else await newSession();
  }
}

function renderSessions(sessions) {
  sessionListEl.innerHTML = "";
  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (s.id === state.currentThreadId ? " active" : "");
    li.textContent = s.title || "新会话";
    li.title = s.title || "新会话";
    li.onclick = () => selectSession(s.id);
    sessionListEl.appendChild(li);
  }
}

async function selectSession(id) {
  state.currentThreadId = id;
  state.aiTurnEl = null;
  // 刷新列表高亮
  for (const li of sessionListEl.children) li.classList.remove("active");
  const history = await window.agent.history(id);
  renderHistory(history);
  // 重新标高亮（renderSessions 依赖 currentThreadId）
  const sessions = await window.agent.listSessions();
  renderSessions(sessions);
}

async function newSession() {
  const s = await window.agent.createSession();
  await loadSessions(s.id);
}

// ---------- 消息渲染 ----------

function clearMessages() {
  messagesEl.innerHTML = "";
}

function renderHistory(history) {
  clearMessages();
  for (const m of history) {
    if (m.role === "user") appendUser(m.text);
    else if (m.role === "ai") {
      const turn = startAiTurn();
      if (m.text.trim()) appendAiText(turn, m.text.trim());
      for (const tc of m.toolCalls || []) appendToolCall(turn, tc.name, tc.args);
    } else if (m.role === "tool") {
      const turn = state.aiTurnEl || startAiTurn();
      appendToolResult(turn, m.text);
    }
  }
  state.aiTurnEl = null;
  scrollBottom();
}

function appendUser(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollBottom();
}

function startAiTurn() {
  const div = document.createElement("div");
  div.className = "msg ai";
  messagesEl.appendChild(div);
  state.aiTurnEl = div;
  return div;
}

function appendAiText(turn, text) {
  const p = document.createElement("div");
  p.className = "ai-text";
  p.textContent = text;
  turn.appendChild(p);
  scrollBottom();
}

function appendToolCall(turn, name, args) {
  const div = document.createElement("div");
  div.className = "tool-call";
  div.textContent = `🔧 ${name}(${truncate(JSON.stringify(args), 200)})`;
  turn.appendChild(div);
  scrollBottom();
}

function appendToolResult(turn, text) {
  const div = document.createElement("div");
  div.className = "tool-result";
  div.textContent = `↳ ${truncate(text, 800)}`;
  turn.appendChild(div);
  scrollBottom();
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- 发送 + 事件流 ----------

function setRunning(running) {
  state.running = running;
  inputEl.disabled = running;
  sendBtn.disabled = running;
  newBtn.disabled = running;
}

async function submit() {
  const text = inputEl.value.trim();
  if (!text || state.running || !state.currentThreadId) return;
  inputEl.value = "";
  autoGrow();
  appendUser(text);
  state.aiTurnEl = null;
  setRunning(true);
  try {
    await window.agent.send(state.currentThreadId, text);
  } catch (err) {
    appendError(String(err));
    setRunning(false);
  }
}

function appendError(message) {
  const div = document.createElement("div");
  div.className = "msg error";
  div.textContent = `❌ ${message}`;
  messagesEl.appendChild(div);
  scrollBottom();
}

window.agent.onRunEvent((e) => {
  // 只渲染当前会话的事件
  if (e.threadId !== state.currentThreadId) return;
  switch (e.type) {
    case "run:ai": {
      const turn = state.aiTurnEl || startAiTurn();
      appendAiText(turn, e.text);
      break;
    }
    case "run:tool_call": {
      const turn = state.aiTurnEl || startAiTurn();
      appendToolCall(turn, e.name, e.args);
      break;
    }
    case "run:tool_result": {
      const turn = state.aiTurnEl || startAiTurn();
      appendToolResult(turn, e.text);
      break;
    }
    case "run:interrupt":
      showApproval(e.runId, e.command);
      break;
    case "run:done":
      state.aiTurnEl = null;
      setRunning(false);
      refreshSessionList();
      break;
    case "run:error":
      appendError(e.message);
      state.aiTurnEl = null;
      setRunning(false);
      break;
  }
});

async function refreshSessionList() {
  const sessions = await window.agent.listSessions();
  renderSessions(sessions);
}

// ---------- 审批弹窗 ----------

function showApproval(runId, command) {
  state.pendingRunId = runId;
  modalCmd.textContent = `$ ${command}`;
  modal.classList.remove("hidden");
}

function resolveApproval(approved) {
  if (!state.pendingRunId) return;
  window.agent.resolveApproval(state.pendingRunId, approved);
  state.pendingRunId = null;
  modal.classList.add("hidden");
}

el("approve-ok").onclick = () => resolveApproval(true);
el("approve-deny").onclick = () => resolveApproval(false);

// ---------- 输入框交互 ----------

function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
}

inputEl.addEventListener("input", autoGrow);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});
composerEl.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});
newBtn.onclick = () => newSession();
approvalToggle.onchange = () => window.agent.setApproval(approvalToggle.checked);

// ---------- 启动 ----------

loadSessions();

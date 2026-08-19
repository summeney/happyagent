<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { state, initAgent, newThread, selectThread, send, cancel } from "./lib/agent.js";

const input = ref("");
const currentMessages = computed(() => (state.currentId ? state.messages[state.currentId] ?? [] : []));
const currentRunning = computed(() => (state.currentId ? !!state.running[state.currentId] : false));
const canSend = computed(() => state.status === "ready" && !!state.currentId && !currentRunning.value && !!input.value.trim());

const statusLabel = computed(
  () => ({ starting: "运行时启动中…", ready: "就绪", unavailable: "运行时不可用" })[state.status] ?? state.status,
);

async function onSend() {
  if (!canSend.value) return;
  const text = input.value;
  input.value = "";
  await send(text);
}

onMounted(initAgent);
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <div class="side-head">
        <span>会话</span>
        <button class="new" :disabled="state.status !== 'ready'" @click="newThread">＋ 新建</button>
      </div>
      <ul class="threads">
        <li
          v-for="t in state.threads"
          :key="t.id"
          :class="{ active: t.id === state.currentId }"
          @click="selectThread(t.id)"
        >
          <span class="title">{{ t.title }}</span>
          <span v-if="state.running[t.id]" class="dot" title="生成中" />
        </li>
        <li v-if="state.threads.length === 0" class="empty">暂无会话</li>
      </ul>
    </aside>

    <main class="main">
      <div class="statusbar" :class="state.status">运行时：{{ statusLabel }}</div>

      <div v-if="!state.currentId" class="placeholder">
        新建或选择一个会话开始对话
      </div>

      <div v-else class="chat">
        <div v-for="(m, i) in currentMessages" :key="i" class="msg" :class="m.role">
          <template v-if="m.role === 'user'"><b>你</b><div class="body">{{ m.text }}</div></template>
          <template v-else-if="m.role === 'ai'"><b>🤖</b><div class="body">{{ m.text }}</div></template>
          <template v-else-if="m.role === 'tool_call'">
            <b>🔧</b><div class="body">调用 {{ m.name }}(<code>{{ JSON.stringify(m.args) }}</code>)</div>
          </template>
          <template v-else><b>↳</b><div class="body tool">{{ m.text }}</div></template>
        </div>
        <div v-if="currentRunning" class="running">
          生成中… <button class="stop" @click="cancel(state.currentId!)">停止</button>
        </div>
      </div>

      <form class="composer" @submit.prevent="onSend">
        <textarea
          v-model="input"
          :disabled="state.status !== 'ready' || !state.currentId"
          placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
          @keydown.enter.exact.prevent="onSend"
        />
        <button type="submit" :disabled="!canSend">发送</button>
      </form>
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
.app { display: flex; height: 100vh; background: #1a1a1a; color: #e6e6e6; }

.sidebar { width: 240px; border-right: 1px solid #333; display: flex; flex-direction: column; }
.side-head { display: flex; justify-content: space-between; align-items: center; padding: 0.8rem; border-bottom: 1px solid #333; font-size: 0.9rem; color: #aaa; }
.new { background: #2a6; border: none; color: #fff; border-radius: 5px; padding: 0.3rem 0.6rem; cursor: pointer; font-size: 0.8rem; }
.new:disabled { background: #444; cursor: default; }
.threads { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
.threads li { padding: 0.6rem 0.8rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; font-size: 0.9rem; border-bottom: 1px solid #262626; }
.threads li:hover { background: #242424; }
.threads li.active { background: #2d2d3a; }
.threads .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.threads .empty { color: #666; cursor: default; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #f0b400; flex: none; animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }

.main { flex: 1; display: flex; flex-direction: column; }
.statusbar { padding: 0.4rem 1rem; font-size: 0.8rem; background: #222; color: #aaa; }
.statusbar.ready { color: #6ee787; }
.statusbar.unavailable { color: #ff7b72; }
.placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #666; }
.chat { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; }
.msg { display: flex; gap: 0.6rem; align-items: flex-start; }
.msg b { flex: none; }
.msg .body { white-space: pre-wrap; word-break: break-word; }
.msg.user .body { color: #cbe; }
.msg.tool_call .body { color: #f0b400; font-size: 0.9rem; }
.msg .body.tool { color: #888; font-size: 0.85rem; white-space: pre-wrap; }
.msg code { background: #2a2a2a; padding: 0 0.3rem; border-radius: 3px; }
.running { color: #f0b400; font-size: 0.85rem; }
.stop { background: #a33; border: none; color: #fff; border-radius: 4px; padding: 0.15rem 0.6rem; cursor: pointer; font-size: 0.8rem; margin-left: 0.4rem; }

.composer { display: flex; gap: 0.5rem; padding: 0.8rem; border-top: 1px solid #333; }
.composer textarea { flex: 1; resize: none; height: 3rem; background: #222; border: 1px solid #333; color: #e6e6e6; border-radius: 6px; padding: 0.5rem; font-family: inherit; }
.composer button { background: #46f; border: none; color: #fff; border-radius: 6px; padding: 0 1.2rem; cursor: pointer; }
.composer button:disabled { background: #444; cursor: default; }
</style>

# `printUpdate(chunk)` 的 chunk —— 所有可能的 JSON 数据

> 面向 `src/cli.ts` 的 `printUpdate(chunk: Record<string, unknown>)`。
> chunk 来自 `app.stream(input, { streamMode: "updates" })`，结构为 `{ [节点名]: { messages: [...] } }`。
> 下面按「一个 chunk 一个 JSON」枚举所有能出现的形态。字段为消息对象序列化后的语义近似（真实 BaseMessage 还带 `id`、`additional_kwargs` 等，此处只保留 `printUpdate` 会读到的字段：`type` / `content` / `tool_calls`）。

节点名说明：
- 默认（`createReactAgent`）：LLM 节点 = `agent`，工具节点 = `tools`
- 加 `--graph`（手写 StateGraph）：LLM 节点 = `llmCall`，工具节点 = `tools`

下列 JSON 用默认的 `agent`/`tools` 命名；`--graph` 时把 `agent` 换成 `llmCall` 即可，其余完全相同。

---

## A. LLM 节点 —— 纯文本回答（无工具调用，任务将结束）

```json
{
  "agent": {
    "messages": [
      {
        "type": "ai",
        "content": "package.json 依赖了 3 个包：@langchain/core、@langchain/langgraph、dotenv。",
        "tool_calls": []
      }
    ]
  }
}
```

## B. LLM 节点 —— 纯工具调用（content 为空，只发起一次调用）

```json
{
  "agent": {
    "messages": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read_file",
            "args": { "path": "package.json" },
            "id": "call_abc123",
            "type": "tool_call"
          }
        ]
      }
    ]
  }
}
```

## C. LLM 节点 —— 边说边调（content 与 tool_calls 同时存在）

```json
{
  "agent": {
    "messages": [
      {
        "type": "ai",
        "content": "我先看一下 src 目录里有哪些文件。",
        "tool_calls": [
          {
            "name": "list_dir",
            "args": { "path": "src" },
            "id": "call_def456",
            "type": "tool_call"
          }
        ]
      }
    ]
  }
}
```

## D. LLM 节点 —— 一次并行发起多个工具调用

```json
{
  "agent": {
    "messages": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read_file",
            "args": { "path": "src/cli.ts" },
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read_file",
            "args": { "path": "src/agent.ts" },
            "id": "call_2",
            "type": "tool_call"
          }
        ]
      }
    ]
  }
}
```

## E. LLM 节点 —— content 是内容块数组（部分模型返回结构化内容）

> 此时 `printUpdate` 里 `text = JSON.stringify(m.content)`，会原样打出这段数组。

```json
{
  "agent": {
    "messages": [
      {
        "type": "ai",
        "content": [
          { "type": "text", "text": "这是最终答案。" }
        ],
        "tool_calls": []
      }
    ]
  }
}
```

---

## F. 工具节点 —— read_file 成功

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "{\n  \"name\": \"happyagent\",\n  \"dependencies\": { ... }\n}",
        "tool_call_id": "call_abc123",
        "name": "read_file"
      }
    ]
  }
}
```

## G. 工具节点 —— list_dir / grep 结果

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "cli.ts\nagent.ts\ngraph.ts\nmodel.ts\nprompt.ts\ntracing.ts\ntools/",
        "tool_call_id": "call_def456",
        "name": "list_dir"
      }
    ]
  }
}
```

## H. 工具节点 —— run_bash 成功（退出码 0）

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "退出码: 0\nstdout:\n> tsc --noEmit\n（无报错）",
        "tool_call_id": "call_bash1",
        "name": "run_bash"
      }
    ]
  }
}
```

## I. 工具节点 —— run_bash 失败（非零退出码，失败信息回灌，不抛异常）

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "退出码: 1\nstderr:\nsrc/cli.ts(64,5): error TS2322: Type 'string' is not assignable...",
        "tool_call_id": "call_bash2",
        "name": "run_bash"
      }
    ]
  }
}
```

## J. 工具节点 —— run_bash 无输出

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "退出码: 0\n（无输出）",
        "tool_call_id": "call_bash3",
        "name": "run_bash"
      }
    ]
  }
}
```

## K. 工具节点 —— HITL 下用户拒绝执行

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "已被用户拒绝执行该命令：rm -rf /",
        "tool_call_id": "call_bash4",
        "name": "run_bash"
      }
    ]
  }
}
```

## L. 工具节点 —— 写入类工具（write_file / edit_file）

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "已写入 src/hello.ts（42 字节）",
        "tool_call_id": "call_write1",
        "name": "write_file"
      }
    ]
  }
}
```

## M. 工具节点 —— 一个 chunk 里多条 ToolMessage（对应 D 的并行调用）

```json
{
  "tools": {
    "messages": [
      {
        "type": "tool",
        "content": "……cli.ts 的内容……",
        "tool_call_id": "call_1",
        "name": "read_file"
      },
      {
        "type": "tool",
        "content": "……agent.ts 的内容……",
        "tool_call_id": "call_2",
        "name": "read_file"
      }
    ]
  }
}
```

---

## N. `--graph` 路径：节点名变为 llmCall（value 形态与上面完全一致）

```json
{
  "llmCall": {
    "messages": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          { "name": "run_bash", "args": { "command": "npm run typecheck" }, "id": "call_x", "type": "tool_call" }
        ]
      }
    ]
  }
}
```

---

## O. 特殊：`__interrupt__`（HITL 审批信号）——不会进入 printUpdate

> 此 chunk 无 `messages` 字段，在 `cli.ts:136` 被 `if (chunk.__interrupt__) continue` 拦掉，
> 不流入 `printUpdate`；即便流入也会被 `if (!messages) continue` 安全跳过。仅为完整性列出。

```json
{
  "__interrupt__": [
    {
      "value": { "type": "approve_bash", "command": "rm -rf node_modules" },
      "id": "int_001",
      "resumable": true,
      "ns": ["tools:call_bash4"]
    }
  ]
}
```

---

## 速查：一个 chunk 只有一个 key

| key | value | 出现场景 | printUpdate 输出 |
|---|---|---|---|
| `agent` / `llmCall` | `{ messages: [AIMessage] }` | LLM 产出（A~E, N） | `🤖 文本` 和/或 `🔧 调用 xxx(args)` |
| `tools` | `{ messages: [ToolMessage, ...] }` | 工具执行完（F~M） | `↳ 结果`（截断 800 字） |
| `__interrupt__` | `[Interrupt, ...]`（无 messages） | HITL 审批（O） | 不输出（上游拦截） |

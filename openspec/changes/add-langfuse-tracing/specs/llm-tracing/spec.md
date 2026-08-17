## Purpose

为 happyagent 提供把 agent 与大模型的每次交互记录为结构化 trace 的能力,使学习者能通过 Langfuse UI 完整回看一条 ReAct 循环——包括每次 LLM 调用的输入/输出与工具调用的嵌套关系。

## ADDED Requirements

### Requirement: 记录 agent 运行为结构化 trace

系统 SHALL 在配置了 Langfuse 密钥时,把每次 agent 运行(从用户任务输入到运行结束)记录为一条 trace,并在该 trace 下按发生顺序嵌套记录每一次 LLM 调用与每一次工具调用。每次 LLM 调用 SHALL 包含其输入 message 与输出 message;每次工具调用 SHALL 包含工具名、输入参数与返回结果。

#### Scenario: 单步任务被完整记录

- **WHEN** 用户在已配置 Langfuse 密钥的环境下运行一个只需一次 LLM 应答、无工具调用的任务
- **THEN** Langfuse 中出现一条 trace,内含一次 LLM 调用,且该调用记录了发送给模型的 message 与模型返回的 message

#### Scenario: 含工具调用的任务被嵌套记录

- **WHEN** 用户运行一个触发了工具调用(如 `read_file`)的任务
- **THEN** trace 中按顺序包含 LLM 调用与工具调用,工具调用记录了工具名、输入参数与返回结果

### Requirement: 两种 agent 实现均被记录且无需改动

系统 SHALL 保证预制版(`createReactAgent`)与手写版(`StateGraph`)两条 agent 执行路径在启用 tracing 时都被完整记录,且记录能力不依赖于修改这两条路径各自的实现。

#### Scenario: 切换实现不影响记录

- **WHEN** 用户分别以默认模式和 `--graph` 模式运行同一任务
- **THEN** 两次运行都在 Langfuse 中产生结构等价的 trace

### Requirement: 会话分组

系统 SHALL 把 CLI 的会话标识(`thread_id`)作为 trace 的会话分组依据,使同一会话标识下的多次运行在 UI 中归属于同一个 session。

#### Scenario: 同一 thread 的多次运行归到一组

- **WHEN** 用户以相同的 `--thread <id>` 连续运行多个任务
- **THEN** 这些运行在 Langfuse 中归属于同一个 session,可一起查看

### Requirement: 缺少配置时优雅降级

当运行环境未配置 Langfuse 密钥时,系统 SHALL 让 agent 正常运行且不因缺少 tracing 配置而报错或中断;此时 tracing 表现为无操作(no-op),不产生 trace。

#### Scenario: 无密钥离线运行

- **WHEN** 用户在未设置 Langfuse 密钥的环境下运行任意任务
- **THEN** agent 正常完成任务,终端输出与未引入 tracing 时一致,不产生与 tracing 相关的错误

### Requirement: 进程退出前刷新 trace

在 agent 运行结束、进程退出之前,系统 SHALL 刷新并等待待上报的 trace 数据发送完成,以保证运行产生的 trace 不因进程提前退出而丢失。

#### Scenario: 短命 CLI 运行不丢 trace

- **WHEN** 用户运行一个任务,任务完成后进程随即退出
- **THEN** 该次运行产生的 trace 完整出现在 Langfuse 中,不出现缺失或截断

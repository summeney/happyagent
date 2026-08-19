## MODIFIED Requirements

### Requirement: 会话分组

系统 SHALL 把会话标识（`thread_id`）作为 trace 的会话分组依据，使同一会话标识下的多次运行在 Langfuse UI 中归属于同一个 session。

#### Scenario: 同一 thread 的多次运行归到一组

- **WHEN** 用户在同一会话（相同 `thread_id`）中连续运行多个任务
- **THEN** 这些运行在 Langfuse 中归属于同一个 session，可一起查看

### Requirement: 运行结束刷新 trace

系统 SHALL 在每次 agent 运行结束时刷新待上报的 trace 数据，以保证该次运行产生的 trace 不因缓冲未发送而丢失；在应用关闭运行时 server 之前，MUST 完成待上报数据的刷新。

#### Scenario: 运行结束后 trace 完整

- **WHEN** 用户运行一个任务并等其完成
- **THEN** 该次运行产生的 trace 完整出现在 Langfuse 中，不出现缺失或截断

#### Scenario: 应用退出不丢 trace

- **WHEN** 用户在若干次运行后关闭应用
- **THEN** 应用在关闭运行时 server 前刷新待上报数据，已完成运行的 trace 不因退出而丢失

## REMOVED Requirements

### Requirement: 两种 agent 实现均被记录且无需改动

**Reason**: 预制版（`createReactAgent`）与 `--graph` 切换已随"单一 agent 运行时"移除，只剩单一手写 `StateGraph`，不再存在两条执行路径。

**Migration**: 无。tracing 只需覆盖注册到运行时 server 的单一 graph。

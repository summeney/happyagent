## Purpose

定义编码 agent 的核心运行时行为：以单一的手写 ReAct 图为唯一实现，绑定工具、系统提示与模型，供命令行与桌面端共同复用。

## ADDED Requirements

### Requirement: 单一 agent 运行时

系统 SHALL 仅提供一种 agent 运行时实现——手写的 `StateGraph`（ReAct 循环：模型节点 ↔ 工具节点，由是否存在工具调用决定继续或结束）。系统 MUST NOT 再暴露 `createReactAgent` 预制版分支或在其间切换的开关。

#### Scenario: 构建运行时

- **WHEN** 调用方请求构建一个 agent 运行时
- **THEN** 系统返回基于手写 `StateGraph` 编译得到的可运行图，绑定完整工具集、系统提示与所配置的模型

#### Scenario: 不再提供分支切换

- **WHEN** 用户通过命令行传入历史上的 `--graph` 开关
- **THEN** 该开关不再有任何效果（被忽略或不被识别），系统始终以手写 `StateGraph` 运行

### Requirement: 运行时可注入持久化与模型

系统 SHALL 允许在构建运行时时注入一个 checkpointer 与模型名；当提供 checkpointer 时，运行时 MUST 按 `thread_id` 保存和续接会话状态。

#### Scenario: 注入 checkpointer 后多轮续接

- **WHEN** 以同一 `thread_id` 先后两次向注入了 checkpointer 的运行时发送消息
- **THEN** 第二次调用能读到第一次的消息历史，并在其基础上继续对话

#### Scenario: 未注入 checkpointer 时单轮运行

- **WHEN** 构建运行时未注入 checkpointer 并发送一条消息
- **THEN** 运行时完成一次 ReAct 循环并结束，不保留跨调用的历史

### Requirement: 危险操作可选人工审批

系统 SHALL 支持对 `run_bash` 工具启用人工审批：启用后，执行 shell 命令前运行时 MUST 中断（interrupt）并等待外部批准决定，凭批准结果决定执行或跳过。

#### Scenario: 审批开启并批准

- **WHEN** 审批已开启，且 agent 请求执行一条 shell 命令，外部返回"批准"
- **THEN** 运行时执行该命令并将结果回灌为工具消息

#### Scenario: 审批开启并拒绝

- **WHEN** 审批已开启，且 agent 请求执行一条 shell 命令，外部返回"拒绝"
- **THEN** 运行时不执行该命令，并将"已拒绝"作为工具结果回灌，循环继续

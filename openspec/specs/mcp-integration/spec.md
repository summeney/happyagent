# mcp-integration Specification

## Purpose
定义 agent 如何接入外部 MCP（Model Context Protocol）server：从配置连接、把远端工具并入 agent 可用工具集，并在连接或调用失败时保持 agent 可用。

## Requirements

### Requirement: 从配置连接 MCP server

系统 SHALL 支持按用户提供的配置连接一个或多个外部 MCP server；对每个成功连接的 server，系统 MUST 发现其提供的工具并将这些工具并入 agent 的可用工具集。

#### Scenario: 连接后工具可用

- **WHEN** 用户配置了一个可用的 MCP server 并启动应用
- **THEN** 该 server 暴露的工具出现在 agent 的可用工具集中，agent 可在 ReAct 循环中调用它们

#### Scenario: 未配置任何 MCP server

- **WHEN** 用户未配置任何 MCP server
- **THEN** agent 以内置工具集正常运行，不因缺少 MCP 配置而报错

### Requirement: MCP 工具调用结果回灌

系统 SHALL 在 agent 调用某个 MCP 工具时执行远端调用，并把其结果作为工具消息回灌给模型，与内置工具的处理方式一致。

#### Scenario: 调用远端工具

- **WHEN** agent 决定调用某个来自 MCP server 的工具并给出参数
- **THEN** 系统执行该远端调用并把返回结果回灌，模型据此继续推进任务

### Requirement: MCP 故障不拖垮 agent

当某个 MCP server 连接失败、断开或某次工具调用出错时，系统 SHALL 保证 agent 仍可运行：受影响的工具不可用或该次调用返回可读错误，但 MUST NOT 使整个 agent 运行崩溃。

#### Scenario: server 连接失败

- **WHEN** 配置的某个 MCP server 无法连接
- **THEN** 系统记录该情况、跳过其工具，agent 以其余可用工具继续运行，不崩溃

#### Scenario: 工具调用出错

- **WHEN** 某次 MCP 工具调用返回错误或超时
- **THEN** 系统把可读的错误信息作为工具结果回灌给模型，让其调整下一步，而非中断整个运行

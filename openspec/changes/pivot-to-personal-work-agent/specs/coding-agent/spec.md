## MODIFIED Requirements

### Requirement: Kimi 模型接入

系统 SHALL 通过 OpenAI 兼容协议接入 Kimi K2.6 模型，端点为 `https://api.moonshot.cn/v1`，密钥从环境变量 `MOONSHOT_API_KEY` 读取，且 MUST 支持工具调用（function calling）；调用参数 MUST 满足 Kimi 的约束（如 `temperature=1`）。模型的构造 SHALL 可被替换——既支持按模型名构造真实模型，也支持注入一个预设应答的替身模型，以便在不依赖真实网络的情况下测试 agent 逻辑。

#### Scenario: 正常调用模型

- **WHEN** 提供有效的 `MOONSHOT_API_KEY` 并向 agent 发送一条用户消息
- **THEN** 系统调用 Moonshot 端点并返回模型的文本或工具调用响应

#### Scenario: 缺少密钥

- **WHEN** 环境变量 `MOONSHOT_API_KEY` 未设置
- **THEN** 系统在启动或首次调用时给出明确的错误提示，说明需要配置该密钥，而不是抛出无意义的底层异常

#### Scenario: 模型返回工具调用

- **WHEN** 模型决定使用某个已绑定的工具
- **THEN** 系统能解析出规范的工具调用（工具名 + 结构化参数）并据此执行对应工具

#### Scenario: 注入替身模型测试

- **WHEN** 测试中注入一个预设应答的替身模型并驱动一轮 ReAct 循环
- **THEN** agent 使用该替身模型完成循环，不发起真实的 Moonshot 网络调用

## REMOVED Requirements

### Requirement: 命令行交互入口

**Reason**: 项目转为纯桌面应用，命令行入口（`src/cli.ts`）移除，桌面端成为唯一入口。

**Migration**: 改用桌面应用发起任务；批量/脚本化需求可在后续通过运行时 server 的接口另行满足。

### Requirement: 危险操作人工审批

**Reason**: 转为本机个人使用、默认全权限，人工审批（HITL）整体移除。

**Migration**: 无。`run_bash` 直接执行命令；如需限制，请在操作系统层面约束应用运行环境。

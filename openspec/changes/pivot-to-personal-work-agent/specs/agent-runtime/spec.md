## MODIFIED Requirements

### Requirement: 单一 agent 运行时

系统 SHALL 仅提供一种 agent 运行时实现——手写的 `StateGraph`（ReAct 循环：模型节点 ↔ 工具节点，由是否存在工具调用决定继续或结束），并以单一已编译图的形式注册到本机运行时 server，作为所有会话的唯一执行入口。系统 MUST NOT 再暴露 `createReactAgent` 预制版分支、`--graph` 切换开关，或除桌面端之外的其他运行入口。

#### Scenario: 构建运行时

- **WHEN** 运行时 server 加载 agent 图
- **THEN** 系统提供基于手写 `StateGraph` 编译得到的可运行图，绑定完整工具集、系统提示与所配置的模型

#### Scenario: 不再提供分支切换

- **WHEN** 调用方尝试沿用历史上的 `--graph` 或预制版切换方式
- **THEN** 该方式不再被识别，系统始终以单一手写 `StateGraph` 运行

### Requirement: 运行时可注入持久化与模型

系统 SHALL 允许在构建运行时时注入模型（既支持按模型名构建，也支持直接注入一个已构造的聊天模型实例，以便测试中替换为不依赖真实网络的模型），并由运行时 server 提供按 `thread_id` 保存与续接会话状态的持久化能力。

#### Scenario: 注入替身模型用于测试

- **WHEN** 构建运行时时注入一个预设应答的模型实例并发送一条消息
- **THEN** 运行时使用该注入模型完成 ReAct 循环，不发起真实的大模型网络调用

#### Scenario: 注入 checkpointer 后多轮续接

- **WHEN** 以同一 `thread_id` 先后两次向具备持久化的运行时发送消息
- **THEN** 第二次调用能读到第一次的消息历史，并在其基础上继续对话

#### Scenario: 未注入 checkpointer 时单轮运行

- **WHEN** 在不具备持久化的场景（如一次性集成测试）下构建运行时并发送一条消息
- **THEN** 运行时完成一次 ReAct 循环并结束，不保留跨调用的历史

## REMOVED Requirements

### Requirement: 危险操作可选人工审批

**Reason**: 本项目转为作者本机个人使用的工作 agent，默认授予全部权限、不再需要人工审批环节；相关的 `interrupt`/审批分支与开关一并移除，以简化并发运行时。

**Migration**: 不再有审批开关；`run_bash` 直接执行命令。需要限制危险操作的用户应在操作系统层面自行约束（如在受限用户/沙箱中运行应用）。

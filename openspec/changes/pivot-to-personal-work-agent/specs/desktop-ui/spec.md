## MODIFIED Requirements

### Requirement: 桌面应用形态

系统 SHALL 以独立的桌面应用窗口形态提供界面；agent 运行时与工具（含文件读写与 shell 执行）MUST 在本机运行时 server 中执行，界面经该 server 提供的接口发起运行与订阅流式结果。界面 MUST NOT 直接在界面进程内执行 agent 图。

#### Scenario: 启动应用

- **WHEN** 用户启动桌面应用
- **THEN** 系统打开一个应用窗口，展示会话列表与当前会话的聊天区；待本机运行时 server 就绪后即可输入

### Requirement: 同一会话内持续输入交互

界面 SHALL 提供常驻输入框，允许用户在当前会话内不退出、不重启地连续发送多条消息；每条消息 MUST 追加到当前会话的同一 `thread_id` 上。运行中禁止重复提交的限制 SHALL 仅作用于同一会话内，MUST NOT 阻止用户在其他会话发起新的运行。

#### Scenario: 连续追问

- **WHEN** 用户在当前会话发送一条消息并等到回复完成后，再发送第二条消息
- **THEN** 第二条消息与其回复出现在同一会话中，且 agent 的回复参考了第一轮的上下文

#### Scenario: 运行中禁止重复提交

- **WHEN** 当前会话正在生成回复
- **THEN** 界面阻止用户对该会话重复提交新消息，直至本轮结束；但用户仍可切换到其他会话并在其中发送消息

### Requirement: 流式展示运行过程

界面 SHALL 以流式方式增量展示 agent 的运行过程，至少区分并呈现三类内容：AI 文本、工具调用（名称与参数）、工具结果；流式内容经由本机运行时 server 的流式接口订阅获得。

#### Scenario: 增量呈现

- **WHEN** agent 正在执行一轮包含工具调用的 ReAct 循环
- **THEN** 界面按发生顺序增量显示 AI 文本、每次工具调用及其结果，而非等到全部结束后一次性显示

## REMOVED Requirements

### Requirement: run_bash 审批弹窗

**Reason**: 人工审批（HITL）整体移除，界面不再需要审批弹窗。

**Migration**: 无。`run_bash` 命令直接执行，界面直接流式展示其结果。

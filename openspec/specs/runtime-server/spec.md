# runtime-server Specification

## Purpose
定义以本地 LangGraph Server 作为 agent 唯一运行时的可观察行为：桌面应用负责在启动时拉起、运行期守护、退出时关闭该 server，并在其不可用时给出清晰状态。

## Requirements

### Requirement: 应用托管本地运行时 server

桌面应用 SHALL 在启动时于本机拉起一个本地 agent 运行时 server 作为唯一的 agent 执行后端；界面 MUST NOT 直接在界面进程内执行 agent 图，而是经该 server 提供的接口发起运行。

#### Scenario: 启动即拉起 server

- **WHEN** 用户启动桌面应用
- **THEN** 应用在本机启动运行时 server，待其就绪后界面方可发起会话运行

#### Scenario: server 未就绪时的界面状态

- **WHEN** 运行时 server 尚未就绪或启动失败
- **THEN** 界面显示明确的"运行时不可用"状态并禁止发送消息，而非静默失败或崩溃

### Requirement: 运行时 server 生命周期守护

应用 SHALL 守护运行时 server 的生命周期：当 server 异常退出时尝试重启并向界面反映其可用性；当用户退出应用时，应用 MUST 关闭该 server 子进程，不残留孤儿进程。

#### Scenario: server 崩溃后恢复

- **WHEN** 运行时 server 在应用运行期间异常退出
- **THEN** 应用尝试重新拉起 server，恢复就绪后界面重新可用

#### Scenario: 退出应用时清理

- **WHEN** 用户关闭桌面应用
- **THEN** 应用关闭其管理的运行时 server 子进程，系统中不残留该 server 进程

### Requirement: 运行时 server 仅监听本机

运行时 server SHALL 仅在本机回环地址上监听，MUST NOT 对外部网络暴露 agent 执行接口。

#### Scenario: 仅本机可达

- **WHEN** 运行时 server 处于运行状态
- **THEN** 仅本机进程可访问其接口，来自外部网络地址的连接不可达

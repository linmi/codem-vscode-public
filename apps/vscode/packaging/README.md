# CodeM

CodeM 是基于 App Server 的 VS Code 编程助手，支持聊天、代码上下文、历史会话、审批及原生编辑器工作流。

## 安装与使用

1. 在 VS Code 的扩展面板中选择 **从 VSIX 安装…**，选择与 Extension Host 系统和架构匹配的 CodeM 包。
2. 打开 CodeM 活动栏，点击登录，在浏览器完成授权。
3. 打开并信任项目文件夹，选择可用空间后发送消息。

包内已包含对应平台的 Core 和认证程序，无需另装 Node.js、pnpm 或 CodeM CLI。Windows x64、Windows ARM64、Apple Silicon Mac 和 Intel Mac 分别使用不同的安装包。

本地 VS Code 使用本机平台包；Remote SSH、WSL 或容器工作区需要与远程 Extension Host 平台匹配的包。Windows 包不能用于 Linux 的 WSL Extension Host。

默认快捷键：`Ctrl+Alt+M` 聚焦聊天，`Ctrl+K Ctrl+M` 加入选区，聊天内 `Ctrl+.` 切换工作模式，`Ctrl+Alt+A` 选择权限模式；macOS 使用 Cmd。可在 VS Code 设置中调整自动连接、发送键和手动补全。

## 许可证与来源

CodeM 许可证见 `LICENSE`，第三方声明见 `THIRD_PARTY_NOTICES.txt`；Core 与认证程序的许可证分别见 `bin/app-server/LICENSE.core` 和 `bin/app-server/LICENSE.auth`。

源码、完整功能说明及开发验证记录：[codem-vscode](https://github.com/linmi/codem-vscode)。

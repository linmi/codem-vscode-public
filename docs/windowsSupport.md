# Windows VS Code 支持

## 边界与状态

本次补齐现有原生 Extension Host 的 Windows 支持，不新增客户端或 WSL 代理。Core 固定 0.8.44、认证 CLI 固定 0.1.208；Windows x64 对应 `codem-core-win32-x64-msvc`，ARM64 对应 `codem-core-win32-arm64-gnu`，认证包分别为 `codem-cli-win32-x64` / `codem-cli-win32-arm64`。映射依据已安装的固定版本官方 npm 包 manifest 和 launcher。

Host 仍以连接建立时的 canonical cwd 为唯一会话状态键。此前 `thread/read` 严格比较字符串，会把 Windows 下同一目录的分隔符或命名空间差异视为另一个工作区。现在仅在 Windows 返回不同拼写时，通过文件系统 realpath 核实双方指向同一目录，并将结果投影回原连接键。真实不同目录、相对路径和无法核实的路径仍拒绝；不使用无条件小写转换，避免混淆启用了大小写敏感性的目录。

这项核实不新增缓存或持久状态；通常相同路径不增加 I/O，Windows 不同拼写增加两次文件系统查询，没有新增认证、RPC 或子进程。首次/重复读取执行同一校验；失败保留既有恢复失败处理，重载、取消和工作区切换继续由现有 Host 生命周期拥有和清理状态。

## 构建与验证

- 构建按运行 Node 的平台与架构选择原生二进制，Windows Node 架构需与 VS Code Extension Host 一致。错架构、缺文件及哈希不匹配均拒绝加载。
- Windows smoke 启动器按显式路径、用户安装、系统安装定位 `Code.exe`；支持空格和中文目录。明确指定的错误路径直接失败，不转用其他安装，不经过 cmd.exe。
- `pnpm test:windows` 在各平台验证两种 Windows 包布局及损坏拒绝、工作区归属、安装定位、真实子进程 stdio 初始化、关闭与初始化超时。子进程终止策略同属该入口：Windows 进程树的 `taskkill /pid <pid> /t /f` 调用及其启动失败回退通过可注入的进程控制在各平台执行；依赖 POSIX 信号语义的真实进程用例在 Windows 上跳过，真实 `taskkill` 仍需 Windows 运行器验证。RPC fixture 通过当前 Node 可执行文件启动，不再依赖 Unix shebang。
- CI 新增 `windows-latest`（x64）和 `windows-11-arm`，执行 lint、类型检查、上述专项测试、原生构建和 `test:runtime`。后者只检查 CLI 版本及 Core initialize/close，不登录、不消耗模型请求。Windows 专项不是全量测试替代：Ubuntu 原有 `pnpm check` 继续保留；其他既有测试仍有 Unix fixture 假设。
- UI 未修改，模拟界面不作为 Windows 验收依据。真实 Windows 登录、发送、取消、历史恢复及 VS Code 操作仍需要 Windows 实机执行；本机 macOS 验证不能代替这些结果。VSIX 本机打包及四平台 CI 现已接入，参见 [打包流程](packaging.md)。

运行器依据：[GitHub 官方运行器列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。安装位置依据：[VS Code Windows 安装文档](https://code.visualstudio.com/docs/setup/windows)。

## 本次本地验收（2026-09-20，macOS ARM64）

- 单元/集成：`pnpm check` 通过，包含新增 Windows 包布局、路径与安装定位回归；`pnpm test:windows` 通过。这些结果验证 Windows 分支及跨平台 fixture，不代表运行过 Windows EXE。
- 构建：`pnpm build:vscode` 通过。
- 真实 Core：`pnpm --filter codem test:runtime` 通过，验证本机 darwin-arm64 的 Core 0.8.44 initialize/close 与 CLI 0.1.208 版本；没有请求真实模型。
- 模拟界面：未运行，本次没有 Webview 改动。
- 真实 Windows Core / VS Code：当前机器无法执行，Windows CI 尚未触发，登录、发送、取消、重载和历史恢复的完整实机验收未完成。
- 修改集中在会话 cwd 归属边界、测试启动定位和 Windows 验证入口；没有引入缓存、共享可变状态、反向或循环依赖。Host 中其他 cwd 严格比较针对内部已保存的连接键，继续保留；只有外部 `thread/read` 返回值经过真实路径核实。

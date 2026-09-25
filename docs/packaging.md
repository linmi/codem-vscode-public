# VSIX 打包

## 使用

开发环境使用 Node >=22.23.2、pnpm 12.4.1，并先执行 `pnpm install --frozen-lockfile`。在仓库根目录运行：

```sh
pnpm package:vscode
# 可选：显式要求当前机器为目标平台；不匹配则在构建前失败
pnpm package:vscode --target darwin-arm64
pnpm test:packaging
```

输出为仓库根目录 `dist/vsix/codem-0.2.0-<target>.vsix` 及同名 `.sha256`。版本来自扩展 manifest；修改版本只需更新 `apps/vscode/package.json`。重复打包会重新构建并替换同名产物；同一工作区不要同时运行 watch 或另一次打包。打包当前工作树，未提交的代码也会进入构建，但不会自动提交或推送这些改动。

VS Code 扩展菜单的 **从 VSIX 安装…** 或 `code --install-extension <vsix 路径>` 均可安装。分发时匹配 Extension Host 的系统和架构，包括 Remote SSH、WSL、容器中的远程 Host。用户端不需要 Node 或 pnpm。

## 原生平台与 CI

GitHub Actions 中手动运行 **Package VSIX**，四个原生 runner 分别产出 `darwin-arm64`、`darwin-x64`、`win32-x64` 和 `win32-arm64`。每个 job 校验类型、静态规则、平台及打包回归，重新构建并打包，再执行真实 CLI 版本与 Core initialize/close 验证；没有登录或模型请求。成功后保留对应 VSIX 和哈希 artifact 14 天。工作流本身没有发布 Marketplace、创建 Release 或推送代码的步骤。

本机命令根据 Node 的 `process.platform/process.arch` 选择目标，显式 `--target` 只能核实该目标。Linux 原生构建沿用已有 runtime target 映射，但本轮分发 CI 只覆盖四种 macOS/Windows 目标。不同平台不能复用 `bin/app-server/`；也不提供跨平台重标记或 universal 包。

依据：[VS Code 平台包文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)、[官方运行器列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。使用固定开发依赖 `@vscode/vsce@4.0.0`，按该包公开 `createVSIX` / `listFiles` 类型和实现接入。其签名工具的安装脚本显式禁用，因为本流程不执行签名或发布。

## 打包边界与失败处理

现有构建只准备开发目录，不能直接将 pnpm workspace 和平台二进制作为通用扩展压缩。现在 `packageVsix.ts` 负责单次构建与临时目录生命周期，`support/vsixPackage.ts` 负责分发清单和平台校验，`support/bundleNotices.ts` 负责实际打入 bundle 的依赖声明；开发 build/watch 入口保留。

每次打包在输出目录下新建独占 staging，不复用旧 staging。只复制正式 Host/Webview JS/CSS、三个品牌资源、runtime manifest、两个原生可执行文件及许可证、用户安装说明。开发依赖、workspace 引用、构建脚本、源码、sourcemap、测试、模拟预览、任意额外文件及 `.env` 均不进入分发包。扩展的命令、配置、激活事件和平台能力保留。

复制前和复制后均验证 runtime 的平台、版本、文件和 SHA-256。vsce 始终写入 TargetPlatform，并以 `dependencies: false` 打包已 bundle 的代码。只在打包完成后将 VSIX 移入最终文件名，随后写出 SHA-256；普通失败清理本次 staging，已有同名成功产物不因前置失败被删除。进程被强制终止可能留下 `.staging-*` 临时目录，下次不会使用；可在确认没有打包进程后删除。没有新增运行时缓存、认证操作或应用状态。

## 许可证来源

构建根据正式 esbuild metafile 和 PostCSS dependency 信息定位实际嵌入的 npm 包，将许可证汇总到 `dist/THIRD_PARTY_NOTICES.txt`。跳过仅用于指定 ESM/CJS 的嵌套 package.json；相同依赖去重。缺失声明时失败，不静默忽略。React、Radix、Highlight.js、Tailwind、tw-animate-css 等均纳入；Core 和 CLI 的独立许可仍由 runtime staging 复制。

- Synara、T3 的版权声明从本仓库提交 `6cd751f` 的 `apps/vscode/licenses/synara.txt`、`t3Code.txt` 保留到 `packaging/uiNotices.txt`，完整代码来源仍见根目录 `UPSTREAM.md`。本轮没有撤销原许可证文件已暂存的删除。
- shadcn/ui 使用 `@codem/ui` 随组件源码提供的 `packages/ui/src/components/shadcnLicense.md`。
- `react-remove-scroll-bar@2.3.8` 的 npm 包标记 MIT、作者 Anton Korzunov，但未携带 LICENSE，registry 的 gitHead 在官方仓库不可读取。保留官方仓库可读取提交 [`8ca9ba5`](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE) 的完整 MIT 声明到 `packaging/reactRemoveScrollBarLicense.txt`；该仓库提交 manifest 为 2.3.7，不把它声称为 2.3.8 源码验证。补充映射仅适用于当前锁定的 2.3.8，升级后需重新核查。

## 本轮验收（2026-09-20）

- `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test:packaging` 通过。
- 在 macOS ARM64 实际执行 `pnpm package:vscode`，生成约 35 MB 的 VSIX 与 SHA-256。解压检查共 17 个文件，TargetPlatform、runtime target、二进制哈希和 Unix 可执行权限正确，无依赖目录、源码、sourcemap 或测试文件。
- 使用真实 VS Code CLI 和本次专属临时用户/扩展目录安装成功，`--list-extensions --show-versions` 返回 `codem.codem@0.2.0`。没有启动 GUI，临时目录已清理，没有改变用户现有扩展安装。
- Windows 两种架构和 Intel Mac 通过 fixture 覆盖包布局；原生 CI 尚未触发，本地没有生成或实装这三个平台的包。模拟界面、安装后的聊天/登录/模型请求未执行；CLI 安装成功不等于完整交互验收。

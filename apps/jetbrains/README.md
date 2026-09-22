# CodeM IntelliJ IDEA 插件

本地 IntelliJ IDEA 宿主：Kotlin 通过 stdio 直连 Core，JCEF 加载 `@codem/ui`。用户安装包不需要 Node；开发和默认检查需要 JDK 21。

## 锁定版本

本机验收窗口是已打开的 IntelliJ IDEA 2026.2.3（`/Applications/IntelliJ IDEA.app`，IU-262.10968.63）。编译 SDK 仍锁定 2024.3.6，不要静默改 SDK，也不要再执行 `runIde` 拉第二套 IDE。

| 项 | 版本 | 依据 |
| --- | --- | --- |
| 目标 IDE | IntelliJ IDEA 2024.3.6 (`243`) | [Platform Gradle Plugin](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html) 示例 |
| 本机已装 | IntelliJ IDEA 2026.2.3 (`262`) | `/Applications/IntelliJ IDEA.app`，本轮不作为编译 SDK |
| JDK | 21 | 2024.2+ 要求 |
| Kotlin | 2.0.21 | 2024.3 自带 stdlib |
| Gradle Wrapper | 8.13 | 2.5.x 插件可用的 8.x |
| Platform Gradle Plugin | 2.5.0 | 2.x，未采用后来要求 Gradle 9 的版本 |

Core `0.8.45` / CLI `0.1.208` / 历史 schema 13 与 `packages/contracts/manifest.json`、`packages/app-server/src/runtime.ts` 对齐。

## 怎么启动（本机只用已开的 2026.2.3）

同一任务只复用用户已打开的 IntelliJ IDEA 2026.2.3。禁止 `runIde`、禁止新开沙箱/窗口/用户配置目录。

```bash
# 打包、装进本机 2026.2.3，并自动重载**当前**那一个 IU。不要手点「文件 → 重新启动 IDE」。
pnpm --filter @codem/jetbrains reload
# 或：cd apps/jetbrains && ./gradlew installAndReload
```

入口会 `buildPlugin` → 解压到 `~/Library/Application Support/JetBrains/IntelliJIdea2026.2/plugins/codem` → 用 IDEA `restarter` 退出并打开本仓库。禁止 `runIde`、禁止第二套 IDE。JCEF Tool Window 声明了 `require-restart`，不能动态热替换。

`buildPlugin` / `verifyPlugin` 会复用已缓存的 2024.3.6 Community SDK。默认 `domainTest` 与 `pnpm check` 不下载 SDK。加载后打开右侧 **CodeM** Tool Window，或使用 Action `Open CodeM`。

## Tool Window 期望

- 插件加载成功：右侧出现 CodeM。
- JCEF 可用且 `@codem/ui` 已打包：未登录看到 VS Code 同款登录页（codemMark +「登录 CodeM」）；已登录看到欢迎/连接反馈与底部输入栏，不出现黄调试按钮或裸 `disconnected`。分页 / 重试 / 恢复仅在条件成立时出现。
- JCEF 不可用：原生说明页，不是空白崩溃。
- UI 产物缺失：原生说明「共享界面未打包」，不是空白崩溃。
- 登录 / 连接：只读取安装目录 `bin/app-server/runtime.json` 中的锁定 Core/CLI，并校验平台、版本、执行权限和两个二进制的 SHA-256。不读取工作区依赖或 PATH。真实模型不要用默认检查去跑。

## 失败时看日志

1. 本机 IDE：Help → Show Log in Finder，搜索 `CodeM`。
2. 本机日志：`~/Library/Logs/JetBrains/IntelliJIdea2026.2/idea.log`。
3. 界面 notice 不会包含路径、协议帧或密钥。
4. 不要再看 `runIde` 沙箱日志来验收本机窗口。

## 目录

```text
src/main/kotlin/com/codem/intellij/
  core/        进程、RPC、帧、运行包
  account/     认证与空间 broker
  session/     连接/轮次状态与 B 能力请求
  history/     JSONL 重放
  ide/         无 IDE 依赖的端口
  webview/     消息与资源策略
src/plugin/kotlin/   IntelliJ / JCEF 适配，仅 runIde / buildPlugin 编译
tests/               Gradle 测试源
```

## 命令

```bash
pnpm --filter @codem/jetbrains check    # TS 构建脚本类型检查 + domainTest；JDK 缺失必须失败
pnpm --filter @codem/jetbrains test:live # 显式使用当前登录账户/空间调用模型，临时工作区发送、切换、历史恢复及续聊
pnpm --filter @codem/jetbrains test:runtime # 构建并解压 ZIP，独立目录、空 PATH 的真实握手；不登录、不调用模型
./gradlew domainTest                    # 无 IntelliJ SDK
./gradlew buildPlugin                   # 打包到 zip；需要已缓存的 IDEA SDK，不启动 IDE
pnpm --filter @codem/jetbrains reload   # 装进本机 2026.2.3 并自动重载同一 IU
./gradlew verifyPlugin                  # Plugin Verifier；需要额外下载，本机验收不要跑
# 禁止：./gradlew runIde                 # 会再开一套 2024.3.6 沙箱
```

出站 JCEF 桥仍把 JSON 拼进 `executeJavaScript`，不能宣称安全桥已完成。

首版闭环目标仍是方案中的 A01–A11。远程开发、其他 JetBrains IDE、PSI 分析和行内补全不在首版承诺内。

## 更改要点

- 装包后走 `pnpm --filter @codem/jetbrains reload` 自动重载同一 IU，不要再让用户手点重启。
- 编译 SDK 仍锁 2024.3.6；until-build 放到 262.*，本机只装进已开的 2026.2.3，不再 runIde。
- 依赖 `com.intellij.modules.jcef`（2026 独立插件），否则点击右侧 CodeM 会 ClassNotFound。
- 登录页 logo/按钮对齐 VS Code：`codemMark.svg` + `account.css` 主按钮（#6554ee 或宿主默认按钮色），不用自造胶囊和亮黄。
- Tool Window 在 JCEF 可用时挂上共享 UI；不可用或产物缺失时原生降级（带图标，跟随主题）。
- RuntimeLocator 只解析插件 `bin/app-server`，缺失或损坏即失败，不再搜索项目的 pnpm 布局或 PATH。

## 独立运行包（2026-09-22）

构建复用 `@codem/app-server/build` 的 `stageAppServerRuntime`，与 VS Code 使用同一 schema 2 清单和原生二进制来源；该依赖仅用于开发构建，不进入 JVM 运行时。`buildPlugin` 把 Core、认证程序、两份许可证和哈希清单放到插件根目录 `bin/app-server`，不塞入 JAR，不捆绑 Node。

当前构建只包含构建机的平台。本机产物为 **darwin-arm64**，不适用于 Intel Mac、Windows 或 Linux；宿主会在执行前拒绝错误平台。目标平台发布矩阵、第三方 UI 许可证完整审计及 Marketplace 发布不由这份本地包证明。

旧 `runtime/manifest.json` 多平台格式没有实际打包产物或独立消费者，已删除其解析实现；项目 `node_modules` 不再具有为插件提供运行程序的权限。重新构建并安装即可迁移，无用户数据迁移。

验收进展见 [JetBrains 功能准出台账](../../docs/jetbrainsFeatureAcceptance.md)。

`test:live` 默认使用认证程序已选中的空间；可通过 `CODEM_TEST_SPACE` 指定已有空间 key，但不会切换全局账户或空间。缺少登录或有效空间时明确失败，不跳过。每次正常执行发送两条禁止使用工具的文本探针，最多等待每轮 90 秒；独立临时工作区和 `LINCO_SESSIONS_ROOT` 隔离测试历史，退出时检查 Core 回收。默认 `check` 排除 `liveCore` 与 `nativeRuntime` 标签，不访问真实账户或模型。

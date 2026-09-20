# 代码来源

## 2026-09-19：建立活跃 monorepo

本次按需复制归档中的 App Server 服务包，归档文件保持不变。

来源提交：`c389c6304f0108cd50fd31ad3b79bd5402f28ad2`；完整归档提交：`904dddd`。

| 归档来源 | 活跃路径 | 范围 |
| --- | --- | --- |
| `history/packages/app-server/` | `packages/app-server/` | 运行时、认证、空间代理、协议与生命周期实现，配置及全部测试 |
| `history/packages/protocol/` | `packages/protocol/` | 无运行时依赖的共享协议，配置及全部测试 |
| `history/packages/session-history/` | `packages/session-history/` | JSONL schema 13 读取及 reducer，配置及全部测试 |
| `history/LICENSE` | `LICENSE` | 原样保留原仓库 MIT 许可及 Kilo Code / opencode 版权声明 |

三个包的生产源码、测试及包版本原样迁入；README 更新为新工作区实际边界。根 workspace、脚本和锁文件重新建立，只保留所需依赖。CLI `0.1.208`、Core `0.8.37`、TypeScript `7.0.2`、Node types `24.12.4`、Zod `4.1.8` 延续来源中的版本，无依赖升级。

运行时包具有自己的发布许可证；`app-server` 的 staging 逻辑继续复制 Core 与认证 CLI 的许可证，并校验版本和可执行文件哈希。根 MIT 许可不替代这些外部包的许可。

## session-history 的更早来源

依据归档 `history/UPSTREAM.md` 中的 “Core JSONL history recovery (2026-09-16)”：

- `src/shared/` 来自 CodeM Desktop `main@d7763f0af4a9152e9dd4ca54ce6f1e56862b798c` 的 `packages/cli-adapter/src/records/schema.ts`、所需记录处理器和 `session` / `diff` 领域模块。
- 当时仅保留被使用的 barrel 导出，并将包导入改为本地相对 `.ts` 导入；来源路径无独立许可证或版权文件。
- 当时的两项语义调整为：visitor 暴露 reducer 已有的 initial-submission identity；Host 明确只接受 schema 13。本次没有进一步改变 reducer 语义。
- 公共包装层负责安全路径解析、快照绑定分页、取消和工具 blob 哈希校验，不写入历史，不建立第二套持久存储。

旧应用的集成验证属于历史记录。新工作区必须独立运行自身检查；应用接入后再增加对应集成验证。

本次验证：独立安装及 frozen-lockfile 安装通过；三个包类型检查通过；测试共 99 项通过（App Server 81、protocol 6、session-history 12），无跳过。macOS arm64 的实际已安装 Core/CLI 解析、staging、许可证复制与哈希校验通过；未运行在线认证或真实 agent turn。84 个非 README 包文件与归档逐字节一致，归档无修改，新代码无归档路径依赖。

## 2026-09-19：TypeScript 7 + Oxlint

保留 TypeScript 7.0.2，引入 Oxlint 1.83.0 并加入根检查命令。处理首次 lint 发现的问题：删除 Host 中未使用的 `boundedText`，移除 preflight 文案中无效的引号转义，测试中显式断言启动记录存在。空间代理的控制字符拒绝规则保留原行为，并为该正则记录行级 lint 例外及原因。归档保持不变。

验证：lint、三个包类型检查、99 项测试及 frozen-lockfile 安装通过；默认 lint 文件发现不包含归档，临时未使用变量样例能使检查失败。

## 2026-09-19：VS Code 应用素材

从同一来源提交 `c389c6304f0108cd50fd31ad3b79bd5402f28ad2` 的归档按需复制品牌素材与许可证，Host 和 Webview 为新实现。

| 归档来源 | 活跃路径 |
| --- | --- |
| `history/apps/vscode/assets/icons/codem.png` | `apps/vscode/assets/codem.png` |
| `history/apps/vscode/assets/icons/codem-mark.svg` | `apps/vscode/assets/codemMark.svg` |
| `history/apps/vscode/assets/icons/codem-dark.svg` | `apps/vscode/assets/codemActivity.svg` |
| `history/apps/vscode/LICENSE` | `apps/vscode/LICENSE` |

素材保留原品牌用途及许可证，活跃应用不引用归档路径。

## T3 Code UI reference — 2026-09-19

- Repository: https://github.com/pingdotgg/t3code
- Inspected revision: `dfbb11bdd7c3f1a5575cb55d3e3abb12be025727`.
- References: `apps/web/src/components/chat/MessagesTimeline.tsx`, `ComposerPendingApprovalPanel.tsx`, and `MessageCopyButton.tsx`.
- Adapted interaction and presentation patterns into the existing TypeScript Webview: centered constrained timeline, right-aligned user messages, compact expandable activity rows, bottom composer, message copy feedback, and jump to latest. This is a reference-based implementation, not a vendored React application or T3 runtime. No T3 provider, transport, persistence or build stack was imported.
- Upstream MIT notice is retained at `apps/vscode/licenses/t3Code.txt`. CodeM branding and App Server remain authoritative.
- Approval UI is still native VS Code in this version; the reference approval panel was inspected but not ported.

## Synara chat visual intake — 2026-09-19

- Source: https://github.com/Emanuele-web04/synara/tree/33333439c4b9c74d0097bc01196cccc921f67cf3
- Default theme tokens extracted by executing upstream `apps/web/src/theme/theme.logic.ts` with `DEFAULT_THEME_STATE` (both variants). Only the used resolved values are retained in `apps/vscode/webview/synaraTokens.css`; no theme engine or runtime dependency was imported.
- Adapted `apps/web/src/components/chat/composerPickerStyles.ts`, `chatTypography.ts`, `ChatComposerFooter.tsx`, `ComposerModelMenuTrigger.tsx`, `MessagesTimeline.tsx`, `TimelineWorkEntryRow.tsx`, `MessageActionButton.tsx`, `apps/web/src/components/ChatView.tsx`, and `apps/web/src/index.css` into the existing Webview. Kept CodeM branding, Host DTOs, Core transport, and native approvals. The preceding T3-only appearance was superseded.
- Upstream MIT copyright notices for T3 Tools Inc. and Emanuele Di Pietro are retained in `apps/vscode/licenses/synara.txt`.
- Added exact production dependencies Marked 18.0.13 and DOMPurify 3.4.15 because the prior text/code-fence renderer could not render the reference's headings, lists, inline code and tables. Parsed model output is sanitized with an explicit tag/attribute allowlist before it enters the DOM. No React, Synara backend, provider state, lockfile or build system was imported.
- This is a source-based style adaptation for existing chat surfaces; native Host menus and the surrounding VS Code shell are outside visual parity. No claim of full-product pixel identity.

## Synara composer interaction intake — 2026-09-19

- Same pinned Synara commit as above. Referenced composer picker styles, pending approval/user-input panels and numbered choice rows; retained existing MIT notice.
- Replaced native model/mode pickers and approval/question/plan prompts with native-TypeScript Webview panels. No React or upstream backend imported. Host owns opaque one-shot choices, cancellation and session/turn correlation. Native credential and file dialogs remain platform-owned.

## Synara interaction continuation — 2026-09-20

- Same pinned Synara reference. Added native TypeScript work-group disclosures, loading states, effort slider, question navigation, safe attachment cards, local composer commands and message motion.
- Added Highlight.js 11.12.0 (BSD-3-Clause) for eight explicitly registered grammars; existing Marked and DOMPurify do not provide syntax highlighting. Highlighted output is sanitized separately and never grants model HTML new attributes. API verified against https://github.com/highlightjs/highlight.js/blob/11.12.0/docs/api.rst.

## 2026-09-20：历史图片读取边界

查阅本机 `codem-app/src/main/session/source/codem/attachment.ts` 确认 Core 图片位于 `<sessionsRoot>/<projectHash>/<threadId>/attachments/`，并按当前包边界独立实现 `sessionImage.ts`；沿用 schema 13 的会话图片描述与 sha256 校验，不引入桌面文件预览服务或第二份历史存储。较大图片通过按需 Webview 消息读取，单图上限与发送限制一致（20 MiB）。

## Beautiful UI loading state intake — 2026-09-20

- Source: https://www.beautifului.dev/ and the LoadingState React example supplied by the user with this request.
- Adapted the 3×3 pixel grid, staggered chevron animation and shimmer label into `apps/vscode/webview/components/loadingState.tsx` and `loadingState.css`, using existing React dependencies and CodeM theme tokens. No external video, elapsed-time simulation or additional dependency was imported.
- Applied to the live turn header and initial waiting placeholder. Once the current turn has progress, its bottom thinking placeholder disappears; approval, question, plan and stopping feedback remain. Added reduced-motion and forced-colors behavior. This is an adaptation of the supplied loading design, not an import of the full Beautiful UI component library.

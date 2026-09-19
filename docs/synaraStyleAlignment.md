# Synara 样式对齐

基准：`Emanuele-web04/synara@33333439c4b9c74d0097bc01196cccc921f67cf3`，默认 Codex 主题、comfortable 密度、系统 UI 字体。参考仓库不进入 workspace。MIT 版权见 `apps/vscode/licenses/synara.txt`。

## 已落地的源代码映射

| 表面 | 上游依据 | CodeM 实现 |
| --- | --- | --- |
| 明暗颜色 | `theme/theme.logic.ts` + `theme.seed.generated.ts`，执行默认主题计算得到实际颜色 | `webview/synaraTokens.css`；light/dark 两组固定结果 |
| 聊天列 | `composerPickerStyles.ts` 的 46rem 最大宽度，12px/20px 响应式边距 | `styles.css` 的 messages/footer |
| 正文与气泡 | `chatTypography.ts`：12px、1.625 行高、80% 最大气泡宽度、16px 四角圆角、14px/10px 内边距 | `messageView.ts`、`styles.css` |
| 输入框 | `index.css` 的 1.2rem 圆角、55% 材质透明度、40px blur、150% saturate、55% 边框强度；默认两行输入 | `html.ts`、`styles.css` |
| 输入框工具栏 | `ChatComposerFooter.tsx`、`ComposerModelMenuTrigger.tsx`；附件/权限在左，模型/强度/发送在右，发送按钮 28px | `html.ts`；CodeM 工作模式入口保留 |
| 空白页 | `ChatView.tsx` 居中 40px 标志、16px 间距、26px/30px 标题 | CodeM 标志和中文标题 |
| 工具与思考行 | `TimelineWorkEntryRow.tsx` 的紧凑图标行、次级文字色及展开内容 | `messageView.ts`；保留 Core 的状态与完成语义 |
| Markdown | `index.css` `.chat-markdown` 排版 | `markdown.css`；使用 Marked + DOMPurify，表格及代码长行横向滚动限制在内容内 |
| 复制 | `MessageActionButton.tsx` 的 2em 按钮及 1.125em 图标 | 图标复制，成功/失败可访问反馈 |

不是整包移植 React 应用：现有 Host/App Server 边界保持不变。正文中的远程图片、任意 HTML UI、命令链接、本地路径链接没有通过样式迁移获得权限。

## 仍存在的视觉差异

- VS Code 外壳、CodeM 标志、中文文案、工作模式入口与连接提示保留产品自身含义。
- 模型、强度、权限及工作模式菜单，以及审批、问答和计划确认已迁入 Webview；MCP 凭据和文件选择仍使用原生控件。
- 没有添加 Synara 的桌面项目侧栏、Git/终端/浏览器分屏或产品中尚无真实后端能力的按钮。
- 上游部分图标库、语法着色器、复杂消息卡片和交互动效未整体引入。当前验证的是已有聊天表面的源码参数及运行效果，**不是完整产品的像素差分零误差证明**。

## 验证结果（2026-09-19）

- `pnpm check`：Oxlint、TS 7 检查通过；163 个测试通过。
- `pnpm build:vscode`：Host、Webview、样式与 Extension Host 测试包构建通过。
- `pnpm --filter codem test:live`：真实 VS Code Extension Host 激活、原生功能和 App Server 流式消息通过；2 个 delta，Core 完成后回到 ready。
- 真实 VS Code 手工操作：连接、新会话、发送、停止；真实模型输出 H2、列表及 TypeScript 代码块；点击代码复制后可访问名称变为“已复制代码”。非浏览器 fixture。
- 浏览器隔离 fixture：320px 深色、430px 浅色及 1000px 宽屏无横向溢出；宽屏聊天列与输入框实测均为 736px；实测正文 12px/19.5px、输入框圆角 19.2px、高 95px。工具展开状态跨增量更新保留，历史/资源 Escape 关闭并恢复焦点，回到最新及空白页通过。输入框自动随软换行增长，限制在 220px，清空后恢复 59px。
- Markdown 负向验证：模型提供的 script、img/onerror、svg/onload、form、input/onfocus 不进入可执行 DOM；command 链接被移除，合法 HTTPS 保留；代码块中的 `<script>` 字面量仍为代码文本。

浏览器截图及检查结果存放 `output/playwright/codemSynara*.png` 与 `codemSynaraChecks.txt`，是测试 fixture，不能当作真实模型执行证据。

## 复现视觉检查

从仓库根目录运行：

```sh
pnpm build:vscode
node --experimental-strip-types apps/vscode/tests/webviewPreview.ts
```

打开 `http://127.0.0.1:4318/`；`?theme=dark` 切换深色，`?empty=1` 显示空白页。服务器只监听 loopback，使用固定测试 DTO，不连接 Core，不读取用户历史或凭据。

用 Playwright CLI 打开上述地址后，将 `apps/vscode/tests/webviewChecks.mjs` 默认导出的函数传给 CLI `run-code` 即可执行交互和内容安全断言。成功返回 `WEBVIEW_CHECKS_OK`。测试不依赖已登录状态；真实模型验证仍单独运行 `test:live`。

## 输入区菜单与请求卡片（2026-09-19）

参考 `composerPickerStyles.ts`、`ComposerPendingApprovalPanel.tsx`、`ComposerChoiceRow.tsx` 和 `ComposerPendingUserInputPanel.tsx`，实现于 `panelView.ts` / `panels.css`：14px 菜单圆角、8px 内边距、输入区材质、编号选项、请求预览、逐题问答和安全 Markdown 计划。模型支持搜索、方向键选择、Escape 关闭及焦点恢复。选择期间不显示多余的“正在设置”状态文案。

Host 的 `PanelBroker` 使用一次性不透明标识，Core 请求和选项标识不进入 Webview；停止、断线、视图销毁与请求结束均撤销待答卡片。默认检查覆盖旧窗口、过期请求、伪造选项、重复提交和取消。浏览器 `panelViewChecks.mjs` 覆盖模型搜索、焦点恢复、多选加自由回答、审批快捷键和计划拒绝。使用 `?panel=model|approval|question|plan` 复现隔离 fixture。

真实 VS Code 已连接 Core 并打开 Webview 模型菜单，实际目录返回 `codem-router/auto`（256,000 tokens）。审批和问答的界面检查使用隔离 fixture，不能当作真实模型触发证据。

本轮复验：`pnpm check`（163 测试）、`pnpm build:vscode`、`test:live` 均通过。真实 Core 返回 1 个流式增量并完成；四类卡片在 320px / 430px 下无横向溢出，`PANEL_UI_OK` 与 `NARROW_PANELS_OK` 均通过。

## 模型入口结构修正

按 `ComposerModelMenuTrigger.tsx` 将模型名、次级强度标签和箭头放入单一按钮，移除嵌套胶囊与独立强度按钮。模型菜单内提供思考强度入口，Host 保持同一设置事务；取消不改变设置。移除旧 `selectEffort` 生产消息，仅负向测试保留其名称。`pnpm check`（164 测试）、构建、菜单交互回归和 430px 悬停布局检查通过。

## 底部提示与布局稳定性

发送提示与工作区信息合并为固定 24px 的单行，提示右对齐；移除按 ready/configuring 状态切换占位的 CSS，避免打开菜单时突然新增一行。窄栏文字省略并保留完整 title，设置事务期间保持工具栏视觉亮度，按钮禁用语义不变。`footerLayoutChecks.mjs` 在 320、430、1000px 下各开合菜单三次，输入框和底栏矩形前后完全一致，均无横向溢出；`pnpm check`（164 测试）和构建通过。

## 菜单锚点定位

模型、强度、权限及工作模式菜单按对应按钮的实际矩形定位，菜单底部距按钮顶部 8px，优先右对齐，受输入区左右边界约束。窗口及输入区尺寸变化时重新计算；高度受可用上方空间限制。审批、追问和计划卡片保留原有文档流布局。删除相对整个 footer 的固定偏移。

`pickerPositionChecks.mjs` 覆盖 320/430/1000px 宽度、480/800px 高度、多行输入和空搜索结果，间距均为 8px，无横向溢出。`pnpm check`（164 测试）及构建通过。

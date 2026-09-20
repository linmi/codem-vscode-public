# shadcn/ui 接入

本次迁移边界是组件运行环境、构建和模拟预览的场景/主题选择器。聊天正文、模型/权限面板和审批仍为原有实现，不能称为全量迁移。

## 来源和适配

- 官方源码：https://ui.shadcn.com/r/styles/new-york-v4/select.json
- 官方安装说明：https://ui.shadcn.com/docs/installation/manual
- 组件源码：apps/vscode/webview/components/select.tsx；MIT 许可证随源码保留在 shadcnLicense.md。
- 保留官方 Radix 结构、键盘和焦点行为；cn 改用本地 clsx/tailwind-merge，添加 Webview CSP nonce，字号和颜色由 CodeM 主题适配。
- React / ReactDOM 19.3.0、radix-ui 1.6.7、Tailwind 4.3.3；精确版本及完整依赖以 package.json / pnpm-lock.yaml 为准。
- components.json 与 TypeScript 路径已配置。后续组件沿用这个入口，不新增另一套组件库。
- Tailwind 仅引入 theme/utilities，不注入全局 Preflight，避免接入时重置既有聊天页面。源码扫描显式限定组件与预览入口；迁移新入口时同步更新扫描范围。
- Select 的 viewport 和滚动锁样式携带文档 nonce；没有放开 unsafe-inline 或外部脚本。
- 预览工具栏使用独立 React root 和独立 bundle，卸载页面时清理；正式 Host 不加载预览脚本。

## 验收

构建：pnpm build:vscode。静态及单元检查：pnpm check。
运行 tests/webviewPreview.ts 后，以现有 Playwright 会话执行 tests/previewSelectChecks.mjs。
检查真实打开菜单的字号/高度、鼠标选择、方向键及 Enter、Escape 返回焦点、点击外部关闭、长列表尾项、深浅主题、刷新保留 URL 选择和窄窗口。捕获 console error，包含 CSP 拒绝。

本次浏览器预览使用模拟数据，不触发 Core；真实 Core 和 VS Code 开发宿主未验收，未为本次工作新开 VS Code。

本次结果：pnpm check、pnpm build:vscode、SHADCN_SELECT_OK 和原有 WORK_GROUP_OK 均通过；浅色与深色菜单截图已人工检查。展开菜单实测选项字号 12px、最大高度 360px，380px 宽视口内无菜单越界，浏览器验收期间无 console error。

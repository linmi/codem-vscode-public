# shadcn/ui 接入

本次迁移边界是组件运行环境、构建和模拟预览的场景目录与主题选择器。聊天正文、模型/权限面板和审批仍为原有实现，不能称为全量迁移。

## 来源和适配

- 官方源码：https://ui.shadcn.com/r/styles/new-york-v4/select.json
- 官方安装说明：https://ui.shadcn.com/docs/installation/manual
- 组件源码：apps/vscode/webview/components/select.tsx；MIT 许可证随源码保留在 shadcnLicense.md。
- 保留官方 Radix 结构、键盘和焦点行为；cn 改用本地 clsx/tailwind-merge，添加 Webview CSP nonce，字号和颜色由 CodeM 主题适配。
- React / ReactDOM 19.3.0、radix-ui 1.6.7、Tailwind 4.3.3；精确版本及完整依赖以 package.json / pnpm-lock.yaml 为准。
- components.json 与 TypeScript 路径已配置。后续组件沿用这个入口，不新增另一套组件库。
- Tailwind 仅引入 theme/utilities，不注入全局 Preflight，避免接入时重置既有聊天页面。源码扫描显式限定组件与预览入口；迁移新入口时同步更新扫描范围。
- Select 的 viewport 和滚动锁样式携带文档 nonce；没有放开 unsafe-inline 或外部脚本。
- 预览导航使用独立 React root 和独立 bundle，卸载页面时清理；正式 Host 不加载预览脚本。

## 验收

构建：pnpm build:vscode。静态及单元检查：pnpm check。
运行 tests/webviewPreview.ts 后，以现有 Playwright 会话执行 tests/previewNavigationChecks.mjs 和 tests/previewLayoutChecks.mjs。
检查目录所有场景、当前项高亮、鼠标与键盘切换、主题菜单的 Escape 返回焦点、刷新与重置保留 URL 选择、窄窗口展开/收起，以及右侧预览的居中和底部边界。捕获 console error，包含 CSP 拒绝。

本次浏览器预览使用模拟数据，不触发 Core；真实 Core 和 VS Code 开发宿主未验收，未为本次工作新开 VS Code。

本次结果：pnpm check、pnpm build:vscode、PREVIEW_NAVIGATION_OK 和 PREVIEW_LAYOUT_OK 均通过；宽屏目录与窄屏展开截图已人工检查，浏览器验收期间无 console error。

场景导航已迁移为左侧分组 TOC，使用 shadcn Button 的链接语义和 Collapsible；主题继续使用 Select。宽屏为 220px 目录＋居中预览，700px 以下通过按钮展开/收起目录。场景链接保留主题，URL 支持刷新恢复。Button / Collapsible 源码来自同一官方 new-york-v4 registry，沿用 MIT 许可证。

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

## 无刷新场景路由

模拟预览使用 TanStack Router 1.170.38 管理 scenario/theme 搜索参数及浏览器历史，目录使用 Router Link，主题使用 router.navigate；禁止通过 location.href 或 reload 进行场景/主题切换。Router 仅作为预览开发依赖，不进入正式聊天脚本。

场景基线由 tests/previewState.ts 统一创建，server 与 router 使用同一参数校验；已存在的 panel/empty 调试链接仍有效。tests/previewRuntime.ts 在当前文档内发布新的模拟快照，切换场景或重置会清理旧定时器、表单草稿和旧面板身份；单独切换主题保留当前场景的交互状态。目录和聊天外框保留 DOM 身份，目录滚动位置不因导航重置。

验证：tests/previewRouterChecks.mjs 检查零新增文档请求、DOM 身份/目录滚动位置保留、前进后退、旧空间刷新失效及连续切换。一次本地浏览器采样中，六次场景更新到下一帧耗时为 11–17ms；这不是生产性能承诺。还需执行 previewNavigationChecks.mjs、previewLayoutChecks.mjs 和既有面板检查。

官方参考：https://tanstack.com/router/latest/docs/routing/code-based-routing 、https://tanstack.com/router/latest/docs/guide/search-params 。通过已锁定版本的本地类型和浏览器行为确认 API。


## App Server 会话工具与回退面板（2026-09-20）

新增独立 React 边界：会话工具、运行详情和回退检查点/范围选择。复用 Select、Button、Collapsible；Dialog、Input、Textarea 源码取自官方 new-york-v4 registry（`https://ui.shadcn.com/r/styles/new-york-v4/{dialog,input,textarea}.json`），MIT 许可证沿用 `components/shadcnLicense.md`。Dialog 滚动锁继续注入 CSP nonce，关闭文案中文化，主题与尺寸使用 CodeM 变量。回退的旧「一律取消」分支已删除；既有模型/审批手写面板仍未迁移。

`sessionToolsChecks.mjs` 在 1440px 浅色、380px 深色验证真实展开菜单、Escape 焦点恢复、目录按需加载、取消不写入、失败保留草稿、迟到回执不清除新编辑、Dialog 内部滚动以及回退两步选择/取消；结果 `SESSION_TOOLS_UI_OK`，无 console/CSP error。截图仅证明模拟 Webview 交互；真实 Core 和 Extension Host 的验证层次见能力接入文档。

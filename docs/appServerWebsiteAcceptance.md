# App Server 文档网站验收

日期：2026-09-22。本 Cycle 仅新增 `apps/docs` 文档网站及入口，不修改运行时、编辑器、认证或 Core 行为。

## 交付与边界

- 居中双栏、左侧固定导航、右侧内容，参考 Beautiful UI 的文档布局；12 个阅读入口涵盖能力、快速开始、架构、参考示例及支持边界。
- 7 类能力索引；9 个 Node TypeScript 示例文件，由编译时文本注入，参加当前 SDK 类型检查。示例为接入片段，不能当成包含登录、审批和生命周期管理的完整应用。
- 版本来自 App Server package.json；正文按本次检查的公开接口和仓库说明整理。进行中的其他能力实现不自动计入本轮文档。
- 浏览器无 Host、密钥、任意路径或原始协议帧访问，无 Core RPC、模型请求和用户数据写入。构建检查 Node 业务实现不进入产物。
- 阅读状态归 URL；Tabs 和复制反馈归页面内组件；移动导航归外壳。切换页面卸载局部状态与复制计时器，重载恢复路由。导航监听在外壳卸载时移除。
- 基础 Button / Tabs 使用仓库已有 shadcn 源码与 MIT 许可证，不新增 UI 框架版本。

## 已执行验证

- `pnpm --filter @codem/docs typecheck`：通过，覆盖网页、构建脚本和全部示例。
- `pnpm --filter @codem/docs test`：通过，验证发布路由、示例源文件、未知路径明确失败。
- `pnpm --filter @codem/docs build`：通过；静态产物 main.js 约 332 KiB、main.css 约 28 KiB；metafile 检查未混入 Node App Server / history 实现。
- `pnpm lint`：通过（全活跃工作区）。
- `git diff --check`：通过。
- 实际文档浏览器：复用同一个 Codex 内置浏览器标签。验证全部导航入口、刷新快速开始深链接、前进后退、未知路径与返回首页、代码复制成功、shadcn Tabs 点击及方向键切换；控制台未见 warning / error。
- 响应式：桌面默认 1280×720；手机 390×844 检查首页、展开导航、选择后关闭、Escape 关闭和代码页；320×740 检查首页。两种手机宽度下 document.scrollWidth 等于 viewport 宽度，没有页面级横向溢出。验证后重置 viewport。
- 预览仅一个 `pnpm --filter @codem/docs dev` 进程，监听 127.0.0.1:4174，保留供用户预览；同一标签从参考站导航至本地页面，不启动额外 Chrome 或 VS Code 开发宿主。

## 未完成与外部阻塞

- 尝试根目录 `pnpm check`，全局 lint 和 docs 类型检查通过；在其他进行中的 VS Code 变更停止：`apps/vscode/src/chat/chatController.ts:448` TS2367，ready 与 configuring 比较无重叠。没有修改该独立任务代码；此轮全仓默认测试阶段未执行，不宣称全仓检查通过。
- 剪贴板权限拒绝的真实浏览器场景未主动模拟；实现有明确失败提示、手动复制建议与重试入口。
- 真实 Core / 模型及真实 VS Code 操作：本轮未运行，网站仅展示文档。Core 0.8.47 压缩缺陷引用仓库已有验收记录，不是网站新增实测。
- 未部署、未 push。源码本地提交，仅包含本 Cycle。

功能修改集中于文档应用；不会改变其他应用状态，不引入反向或循环业务依赖。此次无旧生产入口迁移。

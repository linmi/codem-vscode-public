# CodeM App Server 文档网站

独立浏览器文档应用：左侧导航、右侧内容、居中展示；包含能力说明、使用方式、Node Host 示例及支持边界。视觉参考 [Beautiful UI](https://www.beautifului.dev/) 的居中双栏、外侧斜线与细分隔线；未复制其实现或业务内容。

```sh
pnpm --filter @codem/docs dev       # http://127.0.0.1:4174
pnpm --filter @codem/docs build     # apps/docs/dist
pnpm --filter @codem/docs typecheck
pnpm --filter @codem/docs test
```

构建产物是可独立托管的静态资源。默认仅启动本机预览，不部署。修改 `examples/` 或 App Server 版本配置后，重新启动 dev / build，以刷新编译时注入的数据。

## 边界与生命周期

- `src/docs/`：文档内容、路由和阅读交互；`src/components/ui/`：shadcn 基础组件；`src/styles/`：文档主题；入口只负责挂载。
- `examples/`：使用 App Server 公开接口的 Node TypeScript 片段，参与类型检查，由构建脚本以文本注入网页；浏览器不加载或执行 Node SDK。示例是接入片段，需要应用提供信任校验、登录、审批、状态管理和退出处理。
- 版本从 `packages/app-server/package.json` 构建时读取；页面无认证、RPC、用户历史访问或远程数据依赖。
- 当前文档由 URL hash 保存，刷新、复制链接及前进后退保留目标；未知地址显示明确的未找到页面。导航时焦点移至内容标题。
- 首屏同步显示当前路由；移动端导航默认折叠，切换文档或 Escape 时关闭。无加载占位或延迟隐藏入口。
- 代码复制状态归代码块所有，失败明确提示手动复制/重试；定时反馈在卸载时清理。示例 Tabs 使用 shadcn/Radix，支持方向键切换。

## 来源与验证

Button / Tabs / cn 从 `packages/ui/src/components/` 复制，来源提交 `f58a748cfccefb615bdfbc708156788a140081f8`，保留 shadcn MIT 许可证；文档应用不反向依赖聊天 UI 的内部目录。内容参考当前 `packages/app-server/src`、包 README 和 `docs/appServerCapabilities.md`，旧版本验收记录不冒充当前版本实测。

- 类型检查覆盖网页、构建脚本和可复制示例；文档测试检查发布路由与示例来源，不调用 Core。
- 构建通过 esbuild metafile 阻止 Node App Server / history 实现进入浏览器。
- 浏览器验收记录见 `docs/appServerWebsiteAcceptance.md`。

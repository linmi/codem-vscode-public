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

界面图标统一使用 [Hugeicons React](https://hugeicons.com/docs/integrations/react/quick-start) 与免费 Stroke Rounded 图标包；通过命名导入按需打包，统一 1.5 描边、继承文字颜色，装饰图标对读屏隐藏。版本由根 catalog 固定，品牌标识独立保留。此次替换仅涉及装饰图标和依赖，不新增状态；首次展示、重复操作、复制失败、导航关闭、重载与路由切换沿用现有交互。

图标替换验证（2026-09-22）：文档 lint、类型检查、5 项已有测试、构建及 frozen lockfile 安装通过；复用本地浏览器确认桌面导航 / 能力卡片、390px 移动菜单展开与收起、代码复制成功反馈，控制台无错误。未执行真实 Core 或 IDE 验证，本次没有改动这些边界。

品牌 Logo 使用 `apps/vscode/assets/codemMark.svg` 的原始 SVG（来源提交 `e4f6a4b5ac00e5df98cec1ec2e8eccef5c383e60`，上游来源见根目录 UPSTREAM.md），本地副本位于 `src/assets/codemMark.svg`，用于网页标识与 favicon；保留原品牌用途及许可证。


## 阅读与覆盖评估（2026-09-22）

文档增加常驻导航搜索、页内目录、章节深链接、方法详情筛选、事件字段表及覆盖报告。搜索仅在浏览器内匹配静态文档，不发网络请求；导航选择后清空搜索，Escape 清空输入，移动导航随路由切换收起。方法筛选由 API 组件拥有，章节 / 方法直达参数由 URL 保存；无效参数显示未找到，不静默回到其他章节。

- `apiReference.ts` 维护按 Host 类型穷尽校验的接口与事件清单，网页指标从该清单计算。只统计公开可调用实例方法，不把 getter、顶层函数或相邻包偷偷计入分母。
- 38 个方法有用途、签名摘要和使用条件；23 个方法链接实际调用示例；31 类事件有字段与处理规则。统计口径、剩余 15 项示例缺口、顶层 / 底层范围与真实运行验证缺口在网页 `#/coverage` 公开展示。
- 新增 Input 从 `apps/vscode/webview/components/ui/input.tsx` 复制，来源提交 `0c17e7e6`，保留 shadcn MIT 许可证。
- 初始 9 个示例文件包含 12 个不同 Host 方法调用；本轮 16 个示例文件覆盖 23 个 Host 方法。编译和调用引用检查不等于真实 Core 执行。
- 本轮评估、验收与限制见 [覆盖评估记录](../../docs/appServerDocumentationCoverage.md)。

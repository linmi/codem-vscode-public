# @codem/ui

Dual-host CodeM chat shell. The package depends on browser APIs, React/shadcn, `@codem/protocol`, Marked and DOMPurify. It does not import Node, App Server, history or any editor SDK, and it does not fake `acquireVsCodeApi`.

```ts
import { mountCodemUi, type CodemUiHost } from "@codem/ui"
```

VS Code 与 IDEA 生产路径都挂这份产品壳：登录页、欢迎/连接反馈、消息列表、底部 composer 与 shadcn 菜单。对话区只读 Host 快照；分页/重试/恢复默认隐藏。预览页 `preview.html` 只用于本机对照，不进插件产品表面。

```bash
pnpm --filter @codem/ui build
pnpm --filter @codem/ui preview   # http://127.0.0.1:4320/?host=jetbrains
```

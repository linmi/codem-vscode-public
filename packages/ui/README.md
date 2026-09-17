# @codem/ui

CodeM 的共享 Solid 设计系统。OpenCode 基元与 CLI Console 控件已并入本包；组件经显式子路径导出，不再使用 shadcn、`@opencode-ai/ui` 或 `@kilocode/kilo-web-ui`。

```tsx
import { Button } from "@codem/ui/components/button"
import { ThemeProvider } from "@codem/ui/theme"
import "@codem/ui/styles"
```

VS Code webview 只通过这些导出消费共享控件。时间线 Message/Part 类型走 `@codem/ui/types/session`，不引用 leftover `@kilocode/sdk`。编辑器主题桥、CSP 和 postMessage 留在 `apps/vscode`。

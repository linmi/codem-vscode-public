import { asSnapshot, initialSnapshot, parseUiAction, type ChatMessage, type ChatSnapshot } from "./contract.ts"
import type { CodemUiHost } from "./host.ts"
import { mountCodemUi } from "./mount.tsx"

/**
 * 双宿主预览：同一份产品 ChatApp，仅宿主标签和主题不同。
 * 预览条只在 preview.html，不进 IDEA/VS Code 产品路径。
 */
export type PreviewHostKind = "vscode" | "jetbrains"

/** 预览用共享消息列表样例：覆盖粗斜体、列表、链接、代码与恶意 HTML。 */
export const markdownPreviewText = `# 工作区检查

正文含 **重点**、*说明* 与 \`inline\`。

- 第一项
- 第二项

1. 连接
2. 发送

[公开链接](https://example.com) [危险协议](javascript:alert(1)) [command](command:codem.connect)

\`\`\`ts
const x = "<script>safe code</script>"
\`\`\`

<script>window.__xss=true</script><img src=x onerror="window.__xss=true"><svg onload="window.__xss=true"></svg>
`

export function markdownPreviewMessages(): readonly ChatMessage[] {
  return [
    { id: "user-md", role: "user", text: "请用 **Markdown** 列出步骤，并给一个 `code` 示例。\n\n<script>window.__userXss=true</script>" },
    { id: "assistant-md", role: "assistant", text: markdownPreviewText },
  ]
}

/** 思考、工具与工作分组预览：流式中间进度折进分组，收尾答复在分组外。 */
export function workPreviewMessages(): readonly ChatMessage[] {
  return [
    { id: "user-work", role: "user", text: "检查登录并搜索入口", turnId: "turn-work" },
    { id: "think-1", role: "reasoning", text: "先确认账户状态，再搜索相关符号。", status: "completed", summary: "整理检查顺序", turnId: "turn-work", label: "思考过程" },
    { id: "progress-1", role: "assistant", text: "正在搜索登录入口…", turnId: "turn-work" },
    {
      id: "tool-1",
      role: "tool",
      text: "src/chat/chatController.ts",
      status: "completed",
      summary: "",
      turnId: "turn-work",
      label: "grep",
      details: { kind: "search", fields: [{ label: "查询", value: "signIn" }, { label: "范围", value: "src" }], code: null },
    },
    { id: "think-2", role: "reasoning", text: "", status: "running", summary: "继续核对工具结果", turnId: "turn-work", label: "思考过程" },
  ]
}

export function createPreviewSnapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    ...initialSnapshot(),
    phase: "ready",
    workspace: "demo",
    space: "研发空间",
    threadId: "thread-preview",
    model: "codem-router/auto",
    composerCatalog: {
      models: [
        { id: "codem-router/auto", label: "Auto", description: "连接级目录", selected: true },
        { id: "demo-model", label: "Demo", description: "预览模型", selected: false },
      ],
      spaces: [
        { id: "space-dev", label: "研发空间", description: "当前空间", selected: true },
        { id: "space-ops", label: "运维空间", description: "", selected: false },
      ],
    },
    account: {
      status: "signedIn",
      refreshing: false,
      notice: null,
      profile: { avatar: { kind: "none" }, displayName: "预览用户", userId: "preview-user", tenantId: "preview-team", authMethod: "browser" },
    },
    sessionTools: {
      ...initialSnapshot().sessionTools,
      skills: [{ id: "review", name: "review", description: "结构化 skill，不拼 slash" }],
    },
    capabilities: {
      plan: [{ content: "阅读当前文件", status: "pending" }],
      usage: { input: 12, output: 4, cacheRead: 0, cacheWrite: null },
      activity: "working",
      changes: [{ label: "src/app.ts", added: 3, removed: 1 }],
      threadStatus: "active",
    },
    diffs: [{ id: "diff-1", label: "src/app.ts", added: 3, removed: 1, preview: "complete", available: true }],
    ...overrides,
    type: "state",
  }
}

export function createPreviewHost(kind: PreviewHostKind, snapshot: ChatSnapshot, onAction?: (action: Record<string, unknown>) => void): CodemUiHost & { publish(next: ChatSnapshot): void } {
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  let current = { ...snapshot, theme: snapshot.theme }
  let draft = ""
  return {
    postAction(action) {
      const parsed = parseUiAction(action)
      if (parsed.type === "setTheme" && (parsed.theme === "light" || parsed.theme === "dark")) {
        current = { ...current, theme: parsed.theme }
        listeners.forEach((listener) => listener(current))
      }
      onAction?.(parsed)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState() {
      return { ...current, draft }
    },
    setState(state) {
      draft = String(state.draft ?? draft)
    },
    publish(next) {
      current = asSnapshot(next) ?? next
      listeners.forEach((listener) => listener(current))
    },
  }
}

export function mountPreview(root: HTMLElement, kind: PreviewHostKind, snapshot: ChatSnapshot): { host: ReturnType<typeof createPreviewHost>; dispose: () => void } {
  const host = createPreviewHost(kind, { ...snapshot, theme: snapshot.theme })
  const handle = mountCodemUi(root, host)
  root.dataset.previewHost = kind
  return { host, dispose: () => handle.dispose() }
}

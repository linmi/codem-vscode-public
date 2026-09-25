import { pluginManagementPreview } from "./preview/pluginManagementPreview.ts"
import { conversationSearchPreview } from "./preview/conversationSearchPreview.ts"
import { initialSnapshot, type ChatSnapshot } from "./contract.ts"
import { createPreviewSnapshot, markdownPreviewMessages, markdownPreviewText, mountPreview, workPreviewMessages, type PreviewHostKind } from "./previewHost.ts"

const params = new URLSearchParams(window.location.search)
const hostKind: PreviewHostKind = params.get("host") === "vscode" ? "vscode" : "jetbrains"
const scene = params.get("scene") ?? "ready"
const snapshot = createPreviewSnapshot(
  scene === "failed"
    ? { phase: "failed", canRetry: true, notice: "连接失败，可重试", threadId: null }
    : scene === "resume"
      ? { threadId: null, canResume: true, resumeThreadId: "thread-old" }
      : scene === "approval"
        ? {
            pendingInteraction: "interaction-42",
            pendingPanel: {
              id: "interaction-42",
              kind: "approval",
              title: "允许运行命令",
              description: "选项来自当前请求，不是写死的固定审批编号",
              choices: [
                { id: "allow-once", label: "允许一次" },
                { id: "reject", label: "拒绝" },
              ],
              detail: null,
              allowText: false,
              multiple: false,
              backChoiceId: null,
              initialText: "",
              confirmLabel: null,
            },
          }
        : scene === "markdown"
          ? { messages: markdownPreviewMessages() }
          : scene === "streaming"
            ? { phase: "running", messages: markdownPreviewMessages().slice(0, 1), assistantText: "" }
            : scene === "work"
              ? { messages: workPreviewMessages(), turnTimings: [{ turnId: "turn-work", startedAt: Date.now() - 12_000, finishedAt: null }], phase: "running" }
              : scene === "account"
                ? { account: { status: "signedOut", notice: null }, phase: "disconnected", threadId: null, workspace: null, space: null }
                : scene === "signingIn"
                  ? { account: { status: "signingIn", progress: "waiting" }, phase: "disconnected", threadId: null }
                  : scene === "accountError"
                    ? { account: { status: "error", message: "登录状态检查失败" }, phase: "disconnected", threadId: null }
                    : scene === "checking"
                      ? { ...initialSnapshot(), account: { status: "checking" } }
                      : scene === "older"
                        ? { canLoadOlder: true, hasOlderMessages: true, messages: markdownPreviewMessages() }
                        : {},
)

const bar = document.querySelector("[data-testid='hostBar']")
const label = document.querySelector("[data-testid='hostLabel']")
if (bar instanceof HTMLElement) bar.dataset.host = hostKind
if (label) label.textContent = hostKind === "vscode" ? "VS Code 预览宿主" : "JetBrains 预览宿主"

const root = document.getElementById("codem-root")
if (root) {
  let onAction: ((action: Record<string, unknown>) => void) | undefined
  let starting = snapshot
  let mounted: ReturnType<typeof mountPreview> | undefined
  if (scene === "search") onAction = conversationSearchPreview(next => { starting = next; mounted?.host.publish(next) }, snapshot)
  if (scene === "plugins") onAction = pluginManagementPreview(next => { starting = next; mounted?.host.publish(next) }, snapshot)
  // 条件入口的模拟 Host：点击后先离开条件态，再给出结果；不连 Core。
  if (scene === "failed" || scene === "resume" || scene === "older") {
    const publish = (patch: Partial<ChatSnapshot>) => {
      starting = { ...starting, ...patch, version: starting.version + 1 }
      mounted?.host.publish(starting)
    }
    onAction = action => {
      if (action.type === "connect") {
        publish({ phase: "connecting", canRetry: false, notice: null })
        window.setTimeout(() => publish({ phase: "ready" }), 800)
      } else if (action.type === "resumeThread" && typeof action.threadId === "string") {
        publish({ threadId: action.threadId, canResume: false, resumeThreadId: null, messages: markdownPreviewMessages() })
      } else if (action.type === "olderMessages") {
        publish({ canLoadOlder: false, hasOlderMessages: false, messages: [{ id: "user-earlier", role: "user", text: "更早的一条消息" }, ...starting.messages] })
      }
    }
  }
  mounted = mountPreview(root, hostKind, starting, action => onAction?.(action))
  // 与 Host 一样在挂载后请求打开账户页，而不是在首屏快照里预置开合。
  if (scene === "accountProfile") mounted.host.publish({ ...starting, accountRequest: starting.accountRequest + 1 })
  // 预览未完成轮次：只推进 assistantText，不另建 transcript 存储。
  if (scene === "streaming") {
    const chunks = ["先看 ", "**重点**", "：\n\n- 列表项\n\n```ts\nconst ready", " = true\n```\n\n", markdownPreviewText.slice(markdownPreviewText.indexOf("<script>"))]
    let text = ""
    let index = 0
    const timer = window.setInterval(() => {
      if (index >= chunks.length) {
        window.clearInterval(timer)
        return
      }
      text += chunks[index++]
      mounted!.host.publish({ ...snapshot, phase: "running", assistantText: text })
    }, 200)
  }
}

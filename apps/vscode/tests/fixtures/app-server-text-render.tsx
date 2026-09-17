import { historyTurn } from "../host/services/app-server/fixtures/history"
import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { Message as SDKMessage, Part as SDKPart, AssistantMessage } from "@kilocode/sdk/v2"
import { AppServerMatureUiAdapter } from "../../src/services/app-server/mature-ui-adapter"
import type { Message } from "../../webview-ui/src/types/messages/sessions"

const win = new Window({ url: "http://localhost" })
// Bun 1.3.14 does not populate happy-dom's vm-backed error constructors.
Object.assign(win, { SyntaxError })
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  HTMLDivElement: win.HTMLDivElement,
  HTMLSpanElement: win.HTMLSpanElement,
  HTMLButtonElement: win.HTMLButtonElement,
  SVGElement: win.SVGElement,
  MutationObserver: win.MutationObserver,
  ResizeObserver: win.ResizeObserver,
  CustomEvent: win.CustomEvent,
  Event: win.Event,
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  getComputedStyle: win.getComputedStyle.bind(win),
})

const { createSignal, Show, batch } = await import("solid-js")
const { render } = await import("solid-js/web")
const { Part } = await import("@codem/ui/components/message-part")
const { DataProvider } = await import("@codem/ui/context/data")
const { MarkedProvider, createMarkedParser } = await import("@codem/ui/context/marked")
const { isRenderable } = await import("../../webview-ui/src/utils/transcript-parts")
const parser = createMarkedParser({})
const adapter = new AppServerMatureUiAdapter()
const threadId = "render-thread"
const turnId = "render-turn"
const started = adapter.accept({ type: "turn-started", threadId, turnId, submissionId: "submission" })
assert.equal(started[0]?.type, "messageCreated")
if (started[0]?.type !== "messageCreated") throw new Error("missing assistant message")
const [message, setMessage] = createSignal<Message>(started[0].message)
const delta = adapter.accept({ type: "text-delta", threadId, turnId, itemId: "text", delta: "Hello from CodeM" })[0]
if (delta?.type !== "partUpdated") throw new Error("missing text part")
const [part, setPart] = createSignal<SDKPart>(delta.part as SDKPart)
const root = document.createElement("div")
document.body.append(root)
let dispose: (() => void) | undefined
const settle = () => win.happyDOM.waitUntilComplete()

try {
  // Use the same SDK boundary cast and actual renderer as AssistantMessage.tsx.
  // The old adapter crashes here while TextPartDisplay reads time.completed.
  dispose = render(
    () => (
      <DataProvider
        directory="/fixture"
        data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }}
      >
        <MarkedProvider nativeParser={(text) => parser.parse(text)}>
          <Show when={message().id} keyed>
            {() => <Part part={part()} message={message() as SDKMessage} />}
          </Show>
        </MarkedProvider>
      </DataProvider>
    ),
    root,
  )
  await settle()
  assert.match(root.textContent ?? "", /Hello from CodeM/)
  assert.equal(message().time?.completed, undefined)

  const finalItem = {
    id: "final",
    type: "toolCall",
    status: "completed",
    callId: "final-call",
    toolName: "final_answer",
    label: "Final answer",
    input: {},
    text: "",
    summary: "",
    output: "",
    isError: false,
    subagentId: null,
    subagentKind: null,
    replaced: null,
    kept: null,
    finalAnswer: { status: "complete", kind: "task", summary: "CodeM final answer", artifacts: [] },
  } as const
  const final = adapter
    .accept({ type: "item-completed", threadId, turnId, item: finalItem })
    .find((event) => event.type === "partUpdated" && event.part.type === "text")
  if (final?.type !== "partUpdated") throw new Error("missing final answer")
  setPart(final.part as SDKPart)
  const terminal = adapter
    .accept({ type: "turn-completed", threadId, turnId, outcome: "completed", stopReason: "end_turn", error: null })
    .find((event) => event.type === "messageCreated")
  if (terminal?.type !== "messageCreated") throw new Error("missing completed assistant message")
  setMessage(terminal.message)
  await settle()
  assert.equal(typeof message().time?.completed, "number")
  assert.equal(isRenderable(part(), message() as AssistantMessage), true)
  assert.match(root.textContent ?? "", /CodeM final answer/)

  // Both completed and still-running Core history must satisfy the same renderer.
  for (const completedAt of [null, "2026-09-15T00:00:01.000Z"]) {
    const history = adapter.messagesLoaded({
      threadId,
      turns: [historyTurn(1, completedAt)],
    })
    if (history.type !== "messagesLoaded") throw new Error("missing history")
    const assistant = history.messages.find((entry) => entry.role === "assistant")
    const text = assistant?.parts?.find((entry) => entry.type === "text")
    assert.ok(assistant && text)
    batch(() => {
      setMessage(assistant)
      setPart(text as SDKPart)
    })
    await settle()
    assert.equal(isRenderable(part(), message() as AssistantMessage), true)
    assert.match(root.textContent ?? "", /answer 1/)
  }
} finally {
  dispose?.()
  await win.happyDOM.cancelAsync()
  await win.happyDOM.close()
}

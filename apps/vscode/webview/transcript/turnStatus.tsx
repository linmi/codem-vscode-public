import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { TurnStatusMessage } from "../../src/shared/messages.ts"

export function createTurnStatus(initial: TurnStatusMessage) {
  const root = document.createElement("div")
  root.className = "turnStatus"
  const view = createRoot(root)
  const update = (message: TurnStatusMessage) => {
    flushSync(() => view.render(<p role="status" data-turn-id={message.turnId}>{message.text}</p>))
  }
  update(initial)
  return { root, update, dispose: () => view.unmount() }
}

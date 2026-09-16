import type { AppServerModeState } from "@codem/app-server/modes"
import type { ThreadModesChangedMessage, ThreadModesResultMessage } from "../types/messages/extension-messages"

export interface ThreadPermissionView {
  readonly sessionID: string | null
  readonly requestID: string | null
  readonly state: AppServerModeState | null
  readonly error: string | null
}

export function emptyThreadPermissionView(sessionID: string | null): ThreadPermissionView {
  return { sessionID, requestID: null, state: null, error: null }
}

export function acceptThreadPermissionMessage(
  view: ThreadPermissionView,
  message: ThreadModesChangedMessage | ThreadModesResultMessage,
): ThreadPermissionView {
  if (message.sessionID !== view.sessionID) return view
  if (message.type === "threadModesResult" && message.requestID !== view.requestID) return view
  let state: AppServerModeState | null
  if (message.type === "threadModesChanged") state = message.state
  else {
    if ("error" in message.result) return { ...view, requestID: null, state: null, error: message.result.error }
    state = message.result.state
  }
  if (state === null) return emptyThreadPermissionView(view.sessionID)
  const latest = view.state && view.state.revision > state.revision ? view.state : state
  return {
    ...view,
    state: latest,
    error: null,
    requestID: message.type === "threadModesResult" ? null : view.requestID,
  }
}

import type { AppServerHostEvent, AppServerInteraction, AppServerThreadSummary } from "@codem/app-server"

export interface CodeMWebviewState {
  readonly authenticated: boolean
  readonly trusted: boolean
  readonly workspaceName: string | null
  readonly threadId: string | null
  readonly threads: readonly AppServerThreadSummary[]
  readonly messages: readonly CodeMChatMessage[]
  readonly running: boolean
  readonly error: string | null
  readonly interaction: AppServerInteraction | null
}

export interface CodeMChatMessage {
  readonly id: string
  readonly role: "user" | "assistant" | "system"
  readonly text: string
  readonly pending: boolean
}

export type CodeMWebviewToHostMessage =
  | { readonly type: "ready" }
  | { readonly type: "new-thread" }
  | { readonly type: "open-thread"; readonly threadId: string }
  | { readonly type: "send"; readonly submissionId: string; readonly text: string }
  | { readonly type: "interrupt" }
  | { readonly type: "sign-in" }
  | { readonly type: "sign-out" }
  | { readonly type: "open-settings" }
  | { readonly type: "interaction-response"; readonly requestId: string; readonly response: unknown }

export type CodeMHostToWebviewMessage =
  | { readonly type: "state"; readonly state: CodeMWebviewState }
  | { readonly type: "event"; readonly event: AppServerHostEvent }

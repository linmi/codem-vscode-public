import type * as vscode from "vscode"

// Minimal structural boundary, verified against VS Code 1.138.0 commit
// 7debcd0e2acdea1c52de81bf9ee1620444407dda (chatSessionsProvider + extHostTypes).
// This deliberately does not augment the stable 1.105 API used by the normal extension.
export const nativeSessionType = "codem-native"
export interface NativeSessionItem {
  readonly resource: vscode.Uri
  label: string
  description?: string
  status?: number
  archived?: boolean
}
export interface NativeSessionController extends vscode.Disposable {
  items: {
    replace(items: readonly NativeSessionItem[]): void
    add(item: NativeSessionItem): void
    get(resource: vscode.Uri): NativeSessionItem | undefined
  }
  createChatSessionItem(resource: vscode.Uri, label: string): NativeSessionItem
  newChatSessionItemHandler?: (context: { request: { prompt: string; command?: string } }, token: vscode.CancellationToken) => Promise<NativeSessionItem>
}
export interface NativeChatApi {
  createChatSessionItemController(type: string, refresh: (token: vscode.CancellationToken) => Promise<void>): NativeSessionController
  registerChatSessionContentProvider(type: string, provider: {
    provideChatSessionContent(resource: vscode.Uri, token: vscode.CancellationToken): Promise<{
      history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
      requestHandler: vscode.ChatRequestHandler
    }>
  }, participant: vscode.ChatParticipant, capabilities: { supportsInterruptions: boolean }): vscode.Disposable
}
export interface NativeHistoryApi {
  ChatRequestTurn: new (prompt: string, command: undefined, references: vscode.ChatPromptReference[], participant: string, tools: vscode.ChatLanguageModelToolReference[]) => vscode.ChatRequestTurn
  ChatResponseTurn2: new (parts: vscode.ChatResponseMarkdownPart[], result: vscode.ChatResult, participant: string) => vscode.ChatResponseTurn
}

export function nativeThreadId(resource: { scheme: string; authority: string; path: string; query: string; fragment: string }): string {
  if (resource.scheme !== nativeSessionType || resource.authority || resource.query || resource.fragment || !/^\/[a-zA-Z0-9_-]{1,200}$/.test(resource.path) || resource.path.startsWith("/untitled-")) throw new Error("Invalid native CodeM session resource")
  return resource.path.slice(1)
}

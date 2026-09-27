import type * as vscode from "vscode"

// Minimal structural boundary, verified against VS Code 1.138.0 commit
// 7debcd0e2acdea1c52de81bf9ee1620444407dda (chatSessionsProvider + extHostTypes).
// 1.139.0 (2242ebbb54efeeb0129e08e919e7e8d43033cd83) and 1.139.1 (04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1)
// were diffed against that baseline: the session provider surface and dispatcher are unchanged.
// This deliberately does not augment the stable 1.105 API used by the normal extension.
export const nativeSessionType = "codem-native"
const verifiedMinors = ["1.138", "1.139"]
export const verifiedNativeHosts = verifiedMinors.map(minor => `${minor}.x`).join("、")
/** Proposed APIs change without notice; only releases whose proposal was diffed may activate. */
export function isVerifiedNativeHost(version: string): boolean {
  const match = /^(\d+\.\d+)\.\d+$/.exec(version)
  return match !== null && verifiedMinors.includes(match[1]!)
}
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

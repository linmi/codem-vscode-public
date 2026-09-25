/** Bundle entries that ship. Every TypeScript file under src/ and webview/ must be reachable from one of them. */
export const productionEntries = {
  extension: { path: "src/extension.ts", platform: "node" },
  webview: { path: "webview/main.ts", platform: "browser" },
  nativeChat: { path: "src/nativeChat/nativeChatExtension.ts", platform: "node" },
} as const

export type ProductionEntry = { readonly path: string; readonly platform: "node" | "browser" }
